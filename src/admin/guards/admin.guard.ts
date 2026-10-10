import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { UserRole, UserStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestWithUser } from '../../auth/guards/jwt-auth.guard';

/**
 * Guard dédié à l'espace administration.
 *
 * Pourquoi recharger depuis la DB plutôt que lire request.user.role ?
 * Le JWT contient le rôle au moment de l'émission. Si un admin est rétrogradé
 * (ou suspendu) après connexion, son token reste valide jusqu'à expiration.
 * Ce guard recharge le statut réel depuis la DB pour chaque requête sensible,
 * ce qui est plus coûteux mais obligatoire pour des opérations d'administration.
 *
 * Note : ce guard s'applique APRÈS JwtAuthGuard.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const userId = request.user.userId;

    // Rechargement DB obligatoire — voir commentaire ci-dessus.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, status: true },
    });

    if (!user || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Accès réservé aux administrateurs.');
    }

    if (user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Compte administrateur suspendu.');
    }

    return true;
  }
}
