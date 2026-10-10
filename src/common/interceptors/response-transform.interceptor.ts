import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';

interface DataEnvelope<T> {
  data: T;
}

/**
 * docs/api-contract.md §1 impose que toute réponse réussie ait la forme
 * `{"data": ...}`. Centraliser ça ici évite à chaque contrôleur futur de devoir y
 * penser individuellement (et d'oublier), exactement comme AllExceptionsFilter
 * centralise le format `{"error": ...}` côté échec.
 *
 * Ne s'applique qu'aux réponses JSON "normales" : si un contrôleur a déjà
 * explicitement construit `{ data: ... }` lui-même, ce n'est pas re-enveloppé une
 * deuxième fois.
 */
@Injectable()
export class ResponseTransformInterceptor<T>
  implements NestInterceptor<T, DataEnvelope<T> | T>
{
  intercept(
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<DataEnvelope<T> | T> {
    return next.handle().pipe(
      map((body) => {
        if (
          body &&
          typeof body === 'object' &&
          Object.prototype.hasOwnProperty.call(body, 'data')
        ) {
          return body;
        }
        return { data: body };
      }),
    );
  }
}
