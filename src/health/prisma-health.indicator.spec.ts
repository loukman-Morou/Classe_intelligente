import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaHealthIndicator } from './prisma-health.indicator';
import { PrismaService } from '../prisma/prisma.service';

describe('PrismaHealthIndicator', () => {
  function build(queryRawImpl: () => Promise<unknown>) {
    const prisma = { $queryRaw: jest.fn(queryRawImpl) } as unknown as PrismaService;

    const up = jest.fn().mockReturnValue({ database: { status: 'up' } });
    const down = jest
      .fn()
      .mockReturnValue({ database: { status: 'down', reason: 'database unreachable' } });
    const healthIndicatorService = {
      check: jest.fn().mockReturnValue({ up, down }),
    } as unknown as HealthIndicatorService;

    return { indicator: new PrismaHealthIndicator(prisma, healthIndicatorService), up, down };
  }

  it('renvoie "up" quand SELECT 1 réussit', async () => {
    const { indicator, up, down } = build(() => Promise.resolve([{ '?column?': 1 }]));

    const result = await indicator.check('database');

    expect(up).toHaveBeenCalled();
    expect(down).not.toHaveBeenCalled();
    expect(result).toEqual({ database: { status: 'up' } });
  });

  it('renvoie "down" sans fuiter le détail de l\'erreur quand la DB est injoignable', async () => {
    const { indicator, up, down } = build(() =>
      Promise.reject(new Error('connection refused at 10.0.0.5:5432 user=admin')),
    );

    const result = await indicator.check('database');

    expect(down).toHaveBeenCalledWith({ reason: 'database unreachable' });
    expect(up).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('10.0.0.5');
  });
});
