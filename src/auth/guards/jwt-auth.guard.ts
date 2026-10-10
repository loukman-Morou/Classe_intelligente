import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { RequestUser } from '../auth.types';

/** Forme de `request.user` après que JwtStrategy a validé le token. */
export interface RequestWithUser extends Request {
  user: RequestUser;
}

/**
 * Guard à apposer sur toute route nécessitant un utilisateur authentifié.
 * Délègue à JwtStrategy la validation du token + rechargement statut DB.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  override handleRequest<T = RequestUser>(
    err: Error | null,
    user: T | false,
    info: { message?: string } | null,
  ): T {
    if (err || !user) {
      throw new UnauthorizedException(
        info?.message ?? 'Token manquant ou invalide.',
      );
    }
    return user;
  }
}
