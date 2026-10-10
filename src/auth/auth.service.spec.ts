import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserRole, UserStatus } from '@prisma/client';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

const MOCK_USER = {
  id: 'user-uuid-1',
  email: 'jean@test.com',
  firstName: 'Jean',
  lastName: 'Dupont',
  role: UserRole.STUDENT,
  status: UserStatus.ACTIVE,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MOCK_USER_WITH_HASH = {
  ...MOCK_USER,
  // Hash Argon2id réel de "Password1". En test, argon2.verify est spyé.
  passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$c29tZWhhc2g',
};

const FUTURE_DATE = new Date(Date.now() + 86400 * 1000 * 30);

function makeService(overrides: {
  usersFind?: jest.Mock;
  usersFindByEmail?: jest.Mock;
  usersCreate?: jest.Mock;
  usersExistsByEmail?: jest.Mock;
  prismaRefreshCreate?: jest.Mock;
  prismaRefreshFind?: jest.Mock;
  prismaRefreshUpdate?: jest.Mock;
  prismaRefreshUpdateMany?: jest.Mock;
  jwtSign?: jest.Mock;
  jwtVerify?: jest.Mock;
  jwtDecode?: jest.Mock;
} = {}) {
  const usersService = {
    findByEmailWithPassword:
      overrides.usersFindByEmail ?? jest.fn().mockResolvedValue(MOCK_USER_WITH_HASH),
    findById: overrides.usersFind ?? jest.fn().mockResolvedValue(MOCK_USER),
    create: overrides.usersCreate ?? jest.fn().mockResolvedValue(MOCK_USER),
    existsByEmail: overrides.usersExistsByEmail ?? jest.fn().mockResolvedValue(false),
  } as unknown as UsersService;

  const prisma = {
    refreshToken: {
      create: overrides.prismaRefreshCreate ?? jest.fn().mockResolvedValue({}),
      findUnique: overrides.prismaRefreshFind ?? jest.fn().mockResolvedValue(null),
      update: overrides.prismaRefreshUpdate ?? jest.fn().mockResolvedValue({}),
      updateMany: overrides.prismaRefreshUpdateMany ?? jest.fn().mockResolvedValue({ count: 1 }),
    },
  } as unknown as PrismaService;

  const jwtService = {
    sign: overrides.jwtSign ?? jest.fn().mockReturnValue('signed.jwt.token'),
    verify: overrides.jwtVerify ?? jest.fn().mockReturnValue({ sub: 'user-uuid-1', jti: 'jti-1' }),
    decode: overrides.jwtDecode ?? jest.fn().mockReturnValue({
      exp: Math.floor(Date.now() / 1000) + 86400 * 30,
    }),
  } as unknown as JwtService;

  const configService = {
    get: jest.fn().mockReturnValue({
      accessSecret: 'test-access-secret-long-enough-32ch',
      accessTtl: '15m',
      refreshSecret: 'test-refresh-secret-long-enough-32ch',
      refreshTtl: '30d',
      authThrottleTtlSeconds: 60,
      authThrottleLimit: 5,
    }),
  } as unknown as ConfigService;

  return new AuthService(prisma, usersService, jwtService, configService);
}

// ---------------------------------------------------------------------------
// Register
// ---------------------------------------------------------------------------

describe('AuthService.register', () => {
  it('crée un utilisateur et ne renvoie jamais passwordHash', async () => {
    const service = makeService();
    // On spy argon2.hash pour éviter le coût réel en test unitaire.
    jest.spyOn(require('argon2'), 'hash').mockResolvedValue('hashed');

    const result = await service.register({
      email: 'jean@test.com',
      firstName: 'Jean',
      lastName: 'Dupont',
      password: 'Password1',
    });

    expect(result.user).toEqual(MOCK_USER);
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('lève ConflictException si email déjà utilisé', async () => {
    const service = makeService({
      usersExistsByEmail: jest.fn().mockResolvedValue(true),
    });

    await expect(
      service.register({ email: 'jean@test.com', firstName: 'J', lastName: 'D', password: 'Password1' }),
    ).rejects.toThrow(ConflictException);
  });
});

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

describe('AuthService.login', () => {
  beforeEach(() => {
    jest.spyOn(require('argon2'), 'verify').mockResolvedValue(true);
  });

  it('retourne accessToken + refreshToken + user sans passwordHash', async () => {
    const service = makeService();
    const result = await service.login({ email: 'jean@test.com', password: 'Password1' });

    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('lève UnauthorizedException si email inconnu', async () => {
    jest.spyOn(require('argon2'), 'verify').mockResolvedValue(false);
    const service = makeService({ usersFindByEmail: jest.fn().mockResolvedValue(null) });

    await expect(service.login({ email: 'x@x.com', password: 'P1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('lève UnauthorizedException si mot de passe incorrect', async () => {
    jest.spyOn(require('argon2'), 'verify').mockResolvedValue(false);
    const service = makeService();

    await expect(service.login({ email: 'jean@test.com', password: 'Wrong1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('lève UnauthorizedException si compte suspendu', async () => {
    const service = makeService({
      usersFindByEmail: jest.fn().mockResolvedValue({ ...MOCK_USER_WITH_HASH, status: UserStatus.SUSPENDED }),
    });

    await expect(service.login({ email: 'jean@test.com', password: 'Password1' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('le message est identique pour email inconnu et mdp incorrect (anti-énumération)', async () => {
    jest.spyOn(require('argon2'), 'verify').mockResolvedValue(false);

    const s1 = makeService({ usersFindByEmail: jest.fn().mockResolvedValue(null) });
    const s2 = makeService();

    let msg1 = '', msg2 = '';
    try { await s1.login({ email: 'x@x.com', password: 'P1' }); } catch (e: unknown) { msg1 = (e as Error).message; }
    try { await s2.login({ email: 'jean@test.com', password: 'Wrong1' }); } catch (e: unknown) { msg2 = (e as Error).message; }

    expect(msg1).toBe(msg2);
  });
});

// ---------------------------------------------------------------------------
// Refresh
// ---------------------------------------------------------------------------

describe('AuthService.refresh', () => {
  it('lève UnauthorizedException si token inconnu en DB', async () => {
    const service = makeService({ prismaRefreshFind: jest.fn().mockResolvedValue(null) });
    await expect(service.refresh('fake.token')).rejects.toThrow(UnauthorizedException);
  });

  it('révoque TOUTES les sessions si le token révoqué est réutilisé', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const service = makeService({
      prismaRefreshFind: jest.fn().mockResolvedValue({
        id: 'rt-1', userId: 'user-uuid-1', isRevoked: true, expiresAt: FUTURE_DATE,
      }),
      prismaRefreshUpdateMany: updateMany,
    });

    await expect(service.refresh('revoked.token')).rejects.toThrow(UnauthorizedException);
    expect(updateMany).toHaveBeenCalled();
  });

  it('émet de nouveaux tokens après rotation sur token valide', async () => {
    const service = makeService({
      prismaRefreshFind: jest.fn().mockResolvedValue({
        id: 'rt-1', userId: 'user-uuid-1', isRevoked: false, expiresAt: FUTURE_DATE,
      }),
    });

    const result = await service.refresh('valid.refresh.token');
    expect(result).toHaveProperty('accessToken');
    expect(result).toHaveProperty('refreshToken');
  });
});

// ---------------------------------------------------------------------------
// Logout
// ---------------------------------------------------------------------------

describe('AuthService.logout', () => {
  it('révoque le token — idempotent (count=0 si déjà révoqué)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const service = makeService({ prismaRefreshUpdateMany: updateMany });

    await expect(service.logout('any.token')).resolves.toBeUndefined();
    expect(updateMany).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// getMe
// ---------------------------------------------------------------------------

describe('AuthService.getMe', () => {
  it('retourne les données rechargées depuis la DB sans passwordHash', async () => {
    const service = makeService();
    const result = await service.getMe({ userId: 'user-uuid-1', role: UserRole.STUDENT, jti: 'j1' });

    expect(result.user).toEqual(MOCK_USER);
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('lève UnauthorizedException si user introuvable ou inactif', async () => {
    const service = makeService({ usersFind: jest.fn().mockResolvedValue(null) });
    await expect(
      service.getMe({ userId: 'ghost', role: UserRole.STUDENT, jti: 'j' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
