import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { RequestWithUser } from '../../auth/guards/jwt-auth.guard';

/**
 * À utiliser APRÈS JwtAuthGuard.
 * Réserve la route aux utilisateurs de rôle global PROFESSOR.
 */
@Injectable()
export class ProfessorRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    if (request.user.role !== UserRole.PROFESSOR) {
      throw new ForbiddenException('Seul un utilisateur de rôle PROFESSOR peut accéder à cet espace.');
    }
    return true;
  }
}
