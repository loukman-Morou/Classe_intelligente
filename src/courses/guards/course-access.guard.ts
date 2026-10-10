import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestWithUser } from '../../auth/guards/jwt-auth.guard';
import { CourseAccessContext, CourseContext, CourseRole } from '../courses.types';

/**
 * Guard central de la Phase 4/5.
 *
 * Modèle d'accès Phase 5 (refonte professeur) :
 *  - CLASS_OWNER / CLASS_CO_OWNER  : accès à tous les courses de leur classe
 *  - COURSE_PROFESSOR              : accès uniquement aux cours qu'il a PARTAGÉS
 *                                    dans cette classe (ClassCourse.professorCourseId)
 *  - STUDENT                       : accès à tous les cours de la classe dont il est membre
 *
 * Le cours peut être :
 *  a) Un cours autonome (Course.classId ≠ NULL, créé par le responsable)
 *  b) Une copie d'un cours professeur (ClassCourse.classCourseId = courseId)
 *
 * Dans les deux cas, le guard charge la ressource depuis la DB — jamais depuis
 * le payload client.
 */
@Injectable()
export class CourseAccessGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithUser & { courseAccessContext?: CourseAccessContext }>();

    const { userId, role } = request.user;
    const courseId = request.params['courseId'];

    if (!courseId) {
      throw new ForbiddenException('courseId manquant dans les paramètres de route.');
    }

    // 1. Charger le cours — source de vérité DB.
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true, classId: true, name: true, description: true,
        createdAt: true, updatedAt: true,
      },
    });

    if (!course) throw new NotFoundException('Cours introuvable.');

    // 2. Résoudre la classId effective.
    //    - Course autonome  : classId directement sur Course
    //    - Copie professeur : classId sur Course aussi (renseigné lors du partage)
    const classId = course.classId;
    if (!classId) {
      // Cours original professeur sans classe = espace professeur privé.
      // L'accès à cet espace passe par /professor-courses, pas par /courses/:id.
      throw new ForbiddenException(
        "Ce cours appartient à l'espace professeur. Accédez-y via /api/v1/professor-courses.",
      );
    }

    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, ownerId: true, coOwnerId: true },
    });

    if (!cls) throw new NotFoundException('Classe parente introuvable.');

    // 3. Résoudre le rôle.
    const courseRole = await this.resolveCourseRole(userId, role, classId, courseId, cls);

    if (!courseRole) {
      throw new ForbiddenException("Vous n'avez pas accès à ce cours.");
    }

    request.courseAccessContext = {
      course: course as CourseContext,
      courseRole,
      userGlobalRole: role,
    };

    return true;
  }

  private async resolveCourseRole(
    userId: string,
    globalRole: UserRole,
    classId: string,
    courseId: string,
    cls: { ownerId: string; coOwnerId: string | null },
  ): Promise<CourseRole | null> {
    if (cls.ownerId === userId) return 'CLASS_OWNER';
    if (cls.coOwnerId === userId) return 'CLASS_CO_OWNER';

    if (globalRole === UserRole.PROFESSOR) {
      // Professeur : accès uniquement si ce cours est une copie qu'il a partagée.
      const classCourse = await this.prisma.classCourse.findFirst({
        where: {
          classCourseId: courseId,
          professorCourse: { professorId: userId },
        },
        select: { id: true },
      });
      return classCourse ? 'COURSE_PROFESSOR' : null;
    }

    const membership = await this.prisma.classMember.findUnique({
      where: { userId_classId: { userId, classId } },
      select: { id: true },
    });

    return membership ? 'STUDENT' : null;
  }
}
