import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RequestWithUser } from './jwt-auth.guard';

/**
 * Guard RBAC — à appliquer APRÈS JwtAuthGuard (qui peuple request.user).
 * Vérifie le rôle GLOBAL uniquement. L'autorisation fine par classe/cours
 * sera gérée par des guards spécifiques dans les modules métier (Phase 3+).
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // Pas de @Roles(...) sur la route → accessible à tout user authentifié.
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (!requiredRoles.includes(request.user.role)) {
      throw new ForbiddenException('Accès refusé : rôle insuffisant.');
    }
    return true;
  }
}
