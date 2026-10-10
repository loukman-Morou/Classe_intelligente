import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_INTERCEPTOR, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import configuration from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { ResponseTransformInterceptor } from './common/interceptors/response-transform.interceptor';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ClassesModule } from './classes/classes.module';
import { CoursesModule } from './courses/courses.module';
import { RagModule } from './rag/rag.module';
import { AiModule } from './ai/ai.module';
import { QuizzesModule } from './quizzes/quizzes.module';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { PedagogicalInsightsModule } from './pedagogical-insights/pedagogical-insights.module';
import { OcrModule } from './ocr/ocr.module';
import { ProfessorModule } from './professor/professor.module';
import { CourseSharesModule } from './course-shares/course-shares.module';
import { StorageModule } from './storage/storage.module';
import { ProcessingModule } from './processing/processing.module';
import { DocumentsModule } from './documents/documents.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),

    LoggerModule.forRoot({
      pino: {
        level: process.env.LOG_LEVEL ?? 'info',
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body.password',
            'req.body.token',
            'req.body.refreshToken',
            'req.body.accessToken',
            '*.password',
            '*.token',
            '*.refreshToken',
            '*.accessToken',
            '*.apiKey',
          ],
          censor: '[REDACTED]',
        },
        autoLogging: false,
      },
    }),

    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [
          {
            ttl: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10) * 1000,
            limit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
          },
        ],
      }),
    }),

    PrismaModule,
    AuditModule,
    AdminModule,
    UsersModule,
    AuthModule,
    ClassesModule,
    CoursesModule,
    OcrModule,
    RagModule,
    AiModule,
    QuizzesModule,
    LifecycleModule,
    NotificationsModule,
    AnalyticsModule,
    PedagogicalInsightsModule,
    ProfessorModule,
    CourseSharesModule,
    StorageModule,
    ProcessingModule,
    DocumentsModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseTransformInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
