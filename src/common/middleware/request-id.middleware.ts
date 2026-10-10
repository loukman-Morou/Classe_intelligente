import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

export interface RequestWithId extends Request {
  requestId: string;
}

/**
 * Génère un requestId côté serveur pour chaque requête entrante.
 * On ne fait jamais confiance à un éventuel header client "X-Request-Id" pour la
 * corrélation de sécurité (il pourrait être forgé) : on en génère toujours un nouveau,
 * on ne fait que le renvoyer au client pour qu'il puisse le citer en support.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const requestId = `req_${randomUUID()}`;
    (req as RequestWithId).requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    next();
  }
}
