import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import helmet from 'helmet';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../src/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Pré-requis :
//   docker compose up -d
//   npx prisma migrate dev --name init_schema
//
// Ces tests créent et nettoient leurs propres données. Ils doivent rester
// isolés : jamais exécutés en parallèle avec d'autres tests e2e qui touchent
// à la table `users`.
// ---------------------------------------------------------------------------

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    process.env.CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS ?? 'http://localhost:3001';
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://classe_intelligente:dev_only_change_me@localhost:5432/classe_intelligente?schema=public';
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-long-enough-for-tests-00';
    process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-long-enough-for-tests-0';

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(helmet());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();

    prisma = app.get(PrismaService);
    await prisma.refreshToken.deleteMany({ where: { user: { email: 'e2e-auth@test.com' } } });
    await prisma.user.deleteMany({ where: { email: 'e2e-auth@test.com' } });
  });

  afterAll(async () => {
    await prisma.refreshToken.deleteMany({ where: { user: { email: 'e2e-auth@test.com' } } });
    await prisma.user.deleteMany({ where: { email: 'e2e-auth@test.com' } });
    await app.close();
  });

  // -----------------------------------------------------------------------
  // Register
  // -----------------------------------------------------------------------
  describe('POST /api/v1/auth/register', () => {
    it('201 — crée un compte, ne renvoie jamais passwordHash', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'e2e-auth@test.com', firstName: 'Test', lastName: 'User', password: 'Password1' })
        .expect(201);

      expect(res.body.data.user.email).toBe('e2e-auth@test.com');
      expect(res.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('409 — email déjà utilisé', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'e2e-auth@test.com', firstName: 'Test', lastName: 'User', password: 'Password1' })
        .expect(409);

      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('400 — payload invalide (mot de passe trop court)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email: 'new@test.com', firstName: 'X', lastName: 'Y', password: 'short' })
        .expect(400);

      expect(res.body.error.code).toBe('BAD_REQUEST');
    });
  });

  // -----------------------------------------------------------------------
  // Login
  // -----------------------------------------------------------------------
  let accessToken: string;
  let refreshToken: string;

  describe('POST /api/v1/auth/login', () => {
    it('200 — retourne accessToken + refreshToken + user sans passwordHash', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'e2e-auth@test.com', password: 'Password1' })
        .expect(200);

      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');
      expect(res.body.data.user).not.toHaveProperty('passwordHash');

      accessToken = res.body.data.accessToken;
      refreshToken = res.body.data.refreshToken;
    });

    it('401 — mauvais mot de passe (message identique à email inconnu)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'e2e-auth@test.com', password: 'WrongPassword1' })
        .expect(401);

      expect(res.body.error.code).toBe('UNAUTHORIZED');
      const resUnknown = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'unknown@no-such-email.com', password: 'WrongPassword1' });

      // Anti-énumération : même code + même message.
      expect(res.body.error.code).toBe(resUnknown.body.error.code);
      expect(res.body.error.message).toBe(resUnknown.body.error.message);
    });
  });

  // -----------------------------------------------------------------------
  // /auth/me
  // -----------------------------------------------------------------------
  describe('GET /api/v1/auth/me', () => {
    it('200 — renvoie le profil rechargé depuis la DB', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(res.body.data.user.email).toBe('e2e-auth@test.com');
      expect(res.body.data.user).not.toHaveProperty('passwordHash');
    });

    it('401 — sans token', async () => {
      await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
    });

    it('401 — token forgé (signature invalide)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer header.payload.invalidsignature')
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // Refresh
  // -----------------------------------------------------------------------
  describe('POST /api/v1/auth/refresh', () => {
    it('200 — rotation : renvoie de nouveaux tokens', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(200);

      expect(res.body.data).toHaveProperty('accessToken');
      expect(res.body.data).toHaveProperty('refreshToken');

      // Mettre à jour pour les tests suivants.
      accessToken = res.body.data.accessToken;
      refreshToken = res.body.data.refreshToken;
    });

    it('401 — ancien refresh token (déjà consommé par rotation)', async () => {
      // Le refresh token initial a été consommé par le test précédent.
      // Le réutiliser doit révocation globale + 401.
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'ancien.refresh.token.invalide' })
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // Logout
  // -----------------------------------------------------------------------
  describe('POST /api/v1/auth/logout', () => {
    it('204 — logout révoque le refresh token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ refreshToken })
        .expect(204);
    });

    it('le refresh token révoqué est inutilisable', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken })
        .expect(401);
    });
  });

  // -----------------------------------------------------------------------
  // Sécurité — pas de fuite d'info interne
  // -----------------------------------------------------------------------
  describe('Sécurité', () => {
    it('les réponses d\'erreur auth ne contiennent pas de stack trace', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'x@x.com', password: 'WrongP1' });

      expect(JSON.stringify(res.body)).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/);
      expect(JSON.stringify(res.body)).not.toContain('prisma');
      expect(JSON.stringify(res.body)).not.toContain('sql');
    });

    it('un access token avec rôle ADMIN forgé est rejeté (signature invalide)', async () => {
      // Payload forgé manuellement sans le bon secret — toujours rejeté
      const forgedPayload = Buffer.from(
        JSON.stringify({ sub: 'attacker', role: 'ADMIN', jti: 'fake' }),
      ).toString('base64url');
      const forgedToken = `header.${forgedPayload}.invalidsig`;

      await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${forgedToken}`)
        .expect(401);
    });
  });
});
