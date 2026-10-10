import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestWithUser } from '../../auth/guards/jwt-auth.guard';

/**
 * À appliquer APRÈS JwtAuthGuard sur toute route paramétrée par :classId.
 *
 * Vérifie que :
 *  1. La classe existe (sinon 404).
 *  2. Le user en est membre (ClassMember) OU en est owner/co-owner (sinon 403).
 *
 * Attache `request.classContext` pour que le controller/service puisse en avoir
 * besoin sans refaire un roundtrip DB.
 *
 * Jamais de confiance dans un classId envoyé dans le body — on lit TOUJOURS
 * depuis le param de route :classId, chargé depuis la DB.
 */
@Injectable()
export class ClassMemberGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser & {
      classContext?: import('../classes.types').ClassContext;
    }>();
    const userId = request.user.userId;
    const classId = request.params['classId'];

    if (!classId) {
      throw new ForbiddenException('classId manquant dans les paramètres de route.');
    }

    const cls = await this.prisma.class.findUnique({ where: { id: classId } });
    if (!cls) throw new NotFoundException('Classe introuvable.');

    // Owner et co-owner ont toujours accès, même s'ils ne sont pas en ClassMember
    // (invariant applicatif : ils y sont, mais on défend en profondeur).
    const isOwnerOrCoOwner = cls.ownerId === userId || cls.coOwnerId === userId;

    if (!isOwnerOrCoOwner) {
      const membership = await this.prisma.classMember.findUnique({
        where: { userId_classId: { userId, classId } },
        select: { id: true },
      });
      if (!membership) {
        throw new ForbiddenException("Vous n'êtes pas membre de cette classe.");
      }
    }

    // Attacher le contexte classe à la requête pour éviter un second chargement.
    request.classContext = cls as import('../classes.types').ClassContext;
    return true;
  }
}
