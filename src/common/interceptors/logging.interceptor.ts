import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { RequestWithId } from '../middleware/request-id.middleware';

/**
 * Log structuré minimal par requête : timestamp (géré par le logger), requestId,
 * endpoint, status, duration. Volontairement AUCUN log du body / des headers
 * (Authorization, Cookie) : ces champs peuvent contenir mots de passe, tokens,
 * refresh tokens — voir docs/security.md §Logs.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<RequestWithId>();
    const response = httpContext.getResponse<{ statusCode: number }>();

    const start = Date.now();
    const requestId = request.requestId ?? 'unknown';
    const endpoint = `${request.method} ${request.originalUrl}`;

    return next.handle().pipe(
      tap({
        next: () => {
          const duration = Date.now() - start;
          this.logger.log(
            `requestId=${requestId} endpoint="${endpoint}" status=${response.statusCode} duration=${duration}ms`,
          );
        },
        error: () => {
          const duration = Date.now() - start;
          this.logger.warn(
            `requestId=${requestId} endpoint="${endpoint}" status=${response.statusCode} duration=${duration}ms`,
          );
        },
      }),
    );
  }
}
