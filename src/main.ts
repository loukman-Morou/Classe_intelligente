import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { Logger } from 'nestjs-pino';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { AppConfig } from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  const configService = app.get(ConfigService);
  const appConfig = configService.get<AppConfig>('app');
  if (!appConfig) {
    throw new Error('Configuration "app" manquante après validation ConfigModule.');
  }

  // -------------------------------------------------------------------------
  // Helmet — headers de sécurité HTTP (Phase 14 : config fine)
  // -------------------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc:  ["'self'"],
          scriptSrc:   ["'self'"],
          styleSrc:    ["'self'"],
          imgSrc:      ["'self'", 'data:'],
          connectSrc:  ["'self'"],
          fontSrc:     ["'self'"],
          objectSrc:   ["'none'"],
          frameSrc:    ["'none'"],
          baseUri:     ["'self'"],
          formAction:  ["'self'"],
          ...(process.env.NODE_ENV === 'production'
            ? { upgradeInsecureRequests: [] }
            : {}),
        },
      },
      // HSTS uniquement en production.
      strictTransportSecurity:
        process.env.NODE_ENV === 'production'
          ? { maxAge: 31_536_000, includeSubDomains: true }
          : false,
      frameguard:                 { action: 'deny' },
      hidePoweredBy:              true,
      noSniff:                    true,
      referrerPolicy:             { policy: 'strict-origin-when-cross-origin' },
      crossOriginOpenerPolicy:    { policy: 'same-origin' },
      crossOriginResourcePolicy:  { policy: 'same-origin' },
    }),
  );

  // -------------------------------------------------------------------------
  // CORS strict (Phase 14)
  // -------------------------------------------------------------------------
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin && process.env.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      const allowed = appConfig.corsAllowedOrigins;
      if (!origin || allowed.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS : origin "${origin}" non autorisée.`));
      }
    },
    methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id'],
    credentials:    true,
    maxAge:         86_400,
  });

  // -------------------------------------------------------------------------
  // Limites de payload (Phase 14)
  // Les fichiers ne transitent pas par le backend (URL présignée S3).
  // Cette limite protège contre les payloads JSON malformés ou surdimensionnés.
  // -------------------------------------------------------------------------
  app.use(json({ limit: '1mb' }));
  app.use(urlencoded({ extended: true, limit: '1mb' }));

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist:            true,
      forbidNonWhitelisted: true,
      transform:            true,
      forbidUnknownValues:  true,
      stopAtFirstError:     false,
    }),
  );

  // -------------------------------------------------------------------------
  // Timeout global — 30s par défaut (configurable via REQUEST_TIMEOUT_MS).
  // Les timeouts LLM/OCR dans les services respectifs sont plus courts.
  // -------------------------------------------------------------------------
  app.useGlobalInterceptors(new TimeoutInterceptor(appConfig.requestTimeoutMs));

  app.useGlobalFilters(new AllExceptionsFilter());

  // -------------------------------------------------------------------------
  // Swagger / OpenAPI (Phase 15) — contrat API officiel
  // Exposé uniquement hors production (en production, le contrat est figé
  // et distribué séparément pour ne pas exposer la structure interne).
  // -------------------------------------------------------------------------
  if (appConfig.nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Classe Intelligente — API')
      .setDescription(
        'API backend de la plateforme collaborative Classe Intelligente.\n\n' +
        '**Authentification** : JWT Bearer (access token, durée de vie 15 min).\n\n' +
        '**Format des erreurs** : `{ error: { code, message, requestId } }`\n\n' +
        '**Préfixe** : `/api/v1`',
      )
      .setVersion('1.0')
      .addBearerAuth(
        { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
        'access-token',
      )
      .addTag('Auth', 'Inscription, connexion, refresh, logout')
      .addTag('Classes', 'Gestion des classes et des membres')
      .addTag('Courses', 'Gestion des cours')
      .addTag('Professor', "Espace professeur — cours originaux et partage")
      .addTag('Documents', 'Upload, consultation, téléchargement de documents')
      .addTag('AI', 'Chat IA contextuel et conversations')
      .addTag('Quizzes', 'Génération et persistance des quiz/résumés/flashcards')
      .addTag('Analytics', 'Radar pédagogique et statistiques')
      .addTag('Admin', 'Administration globale (ADMIN uniquement)')
      .addTag('Health', 'Health check infrastructure')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/v1/docs', app, document, {
      swaggerOptions: {
        // Désactiver le bouton "Try it out" par défaut pour éviter les
        // appels accidentels sur un environnement partagé.
        defaultModelsExpandDepth: 2,
        persistAuthorization: true,
      },
    });
  }

  app.enableShutdownHooks();

  await app.listen(appConfig.port);
}

bootstrap();
