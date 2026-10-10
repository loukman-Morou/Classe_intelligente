import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestWithUser } from '../../auth/guards/jwt-auth.guard';
import { ProfessorCourseContext } from '../professor.types';

export interface RequestWithProfCourse extends RequestWithUser {
  profCourseContext?: ProfessorCourseContext & { courseName: string };
}

/**
 * Vérifie que le user est propriétaire du cours professeur (:professorCourseId).
 * Attache `request.profCourseContext` pour éviter un re-chargement DB.
 */
@Injectable()
export class ProfessorCourseOwnerGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithProfCourse>();
    const userId = request.user.userId;
    const professorCourseId = request.params['professorCourseId'];

    if (!professorCourseId) {
      throw new ForbiddenException('professorCourseId manquant dans les paramètres de route.');
    }

    const pc = await this.prisma.professorCourse.findUnique({
      where: { id: professorCourseId },
      include: { course: { select: { name: true, description: true } } },
    });

    if (!pc) throw new NotFoundException('Cours professeur introuvable.');

    if (pc.professorId !== userId) {
      throw new ForbiddenException("Vous n'êtes pas le propriétaire de ce cours.");
    }

    request.profCourseContext = {
      id: pc.id,
      courseId: pc.courseId,
      professorId: pc.professorId,
      version: pc.version,
      name: pc.course.name,
      description: pc.course.description,
      courseName: pc.course.name,
      createdAt: pc.createdAt,
      updatedAt: pc.updatedAt,
    };

    return true;
  }
}
