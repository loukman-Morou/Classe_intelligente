import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import helmet from 'helmet';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

// ⚠️ Depuis la Phase 1, PrismaModule se connecte réellement à PostgreSQL au
// démarrage de l'application (voir src/prisma/prisma.service.ts). Ces tests e2e
// nécessitent donc une base accessible :
//   docker compose up -d
//   (DATABASE_URL par défaut ci-dessous = valeurs de docker-compose.yml)
describe('AppModule (e2e) — infrastructure (Phase 0 + Phase 1)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.CORS_ALLOWED_ORIGINS =
      process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3001';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://classe_intelligente:dev_only_change_me@localhost:5432/classe_intelligente?schema=public';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/v1/health répond 200 avec le check DB "up", enveloppé dans {data}', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.info.database.status).toBe('up');
  });

  it('applique les headers de sécurité helmet', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('renvoie un requestId dans le header X-Request-Id', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health');
    expect(res.headers['x-request-id']).toMatch(/^req_/);
  });

  it("une route inexistante renvoie le format d'erreur standard sans détail interne", async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/route-inexistante');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: expect.any(String),
        requestId: expect.stringMatching(/^req_/),
      },
    });
    expect(JSON.stringify(res.body)).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/); // pas de stack trace
  });
});
