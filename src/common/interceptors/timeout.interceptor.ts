import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

/**
 * Timeout global par requête.
 *
 * Pourquoi ici et pas dans le service : un timeout dans le service n'arrête
 * pas la requête HTTP — le client reste connecté en attendant. Ce timeout
 * interrompt le pipeline NestJS entier et retourne immédiatement un 503,
 * libérant la connexion côté client.
 *
 * Les opérations longues légitimes (génération IA, OCR) ont leur propre
 * timeout dans leur service respectif, inférieur à celui-ci.
 *
 * Durée : configurable (REQUEST_TIMEOUT_MS, défaut 30 000 ms).
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly timeoutMs: number = 30_000) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.timeoutMs),
      catchError((err) => {
        if (err instanceof TimeoutError) {
          return throwError(() => new RequestTimeoutException('La requête a expiré.'));
        }
        return throwError(() => err);
      }),
    );
  }
}
