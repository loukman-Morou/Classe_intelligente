import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { RequestWithId } from '../middleware/request-id.middleware';

interface StandardErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}

/**
 * Unique point de sortie des erreurs de l'API.
 * - Jamais de stack trace, SQL, chemin interne, secret en réponse.
 * - Format conforme docs/api-contract.md §1 : {"error": {code, message, requestId}}.
 * - Lit `error.code` d'une AppException si présente, sinon dérive du statut HTTP.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionsFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<RequestWithId>();
    const requestId = request.requestId ?? 'unknown';

    const { status, code, message } = this.resolve(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `requestId=${requestId} endpoint=${request.method} ${request.originalUrl} status=${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: StandardErrorBody = { error: { code, message, requestId } };
    response.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; code: string; message: string } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      // AppException emballe {code, message} — on l'utilise en priorité.
      if (
        typeof payload === 'object' &&
        payload !== null &&
        'code' in payload &&
        'message' in payload
      ) {
        const typed = payload as { code: string; message: string };
        return { status, code: typed.code, message: typed.message };
      }

      const code = this.codeFromStatus(status);
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? (payload as { message: string | string[] }).message
          : exception.message;

      return {
        status,
        code,
        message: Array.isArray(message) ? message.join(', ') : String(message),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Une erreur interne est survenue.',
    };
  }

  private codeFromStatus(status: number): string {
    const map: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      413: 'FILE_TOO_LARGE',
      422: 'VALIDATION_ERROR',
      429: 'TOO_MANY_REQUESTS',
      503: 'SERVICE_UNAVAILABLE',
    };
    return map[status] ?? 'ERROR';
  }
}
