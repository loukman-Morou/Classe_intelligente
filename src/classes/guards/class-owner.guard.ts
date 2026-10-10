import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestWithUser } from '../../auth/guards/jwt-auth.guard';
import { ClassContext } from '../classes.types';

/**
 * À appliquer APRÈS JwtAuthGuard sur les routes réservées au(x) responsable(s).
 * Si ClassMemberGuard a déjà tourné sur la même route, il a déjà attaché
 * `request.classContext` — on l'utilise pour éviter un second chargement DB.
 */
@Injectable()
export class ClassOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser & {
      classContext?: ClassContext;
    }>();
    const userId = request.user.userId;
    const classId = request.params['classId'];

    if (!classId) {
      throw new ForbiddenException('classId manquant dans les paramètres de route.');
    }

    // Réutilise le contexte si ClassMemberGuard est déjà passé, sinon charge.
    const cls: ClassContext = request.classContext ??
      (await this.prisma.class.findUnique({ where: { id: classId } }) as ClassContext | null) ??
      (() => { throw new NotFoundException('Classe introuvable.'); })();

    if (cls.ownerId !== userId && cls.coOwnerId !== userId) {
      throw new ForbiddenException(
        "Seul le responsable ou le co-responsable peut effectuer cette action.",
      );
    }

    request.classContext = cls;
    return true;
  }
}
