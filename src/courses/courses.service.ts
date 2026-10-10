import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';
import { CourseAccessContext, CourseContext } from './courses.types';

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // Créer un cours dans une classe (owner/co-owner uniquement)
  // --------------------------------------------------------------------------

  async create(
    classId: string,
    dto: CreateCourseDto,
    actorId: string,
  ): Promise<CourseContext> {
    // Vérifier que la classe existe, est ACTIVE, et que l'acteur en est owner/co-owner.
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, status: true, ownerId: true, coOwnerId: true },
    });

    if (!cls) throw new NotFoundException('Classe introuvable.');
    if (cls.status !== ClassStatus.ACTIVE) {
      throw new BadRequestException('Impossible de créer un cours dans une classe non active.');
    }
    if (cls.ownerId !== actorId && cls.coOwnerId !== actorId) {
      throw new ForbiddenException('Seul le responsable ou co-responsable peut créer un cours.');
    }

    // Unicité du nom dans la classe (pas une contrainte DB mais une règle métier
    // explicite pour éviter des doublons confus pour les étudiants).
    const existing = await this.prisma.course.findFirst({
      where: { classId, name: dto.name },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(`Un cours nommé "${dto.name}" existe déjà dans cette classe.`);
    }

    const course = await this.prisma.course.create({
      data: { classId, name: dto.name, description: dto.description ?? null },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'COURSE_CREATED',
      targetType: 'Course',
      targetId: course.id,
      metadata: { classId, name: course.name },
    });

    return course as CourseContext;
  }

  // --------------------------------------------------------------------------
  // Lister les cours d'une classe selon le rôle du user
  // --------------------------------------------------------------------------

  async findAllForClass(classId: string, actorId: string, actorGlobalRole: string): Promise<CourseContext[]> {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, ownerId: true, coOwnerId: true, status: true },
    });

    if (!cls) throw new NotFoundException('Classe introuvable.');

    // Vérifier que le user a accès à cette classe.
    const isOwnerOrCoOwner = cls.ownerId === actorId || cls.coOwnerId === actorId;

    if (!isOwnerOrCoOwner) {
      if (actorGlobalRole === 'PROFESSOR') {
        // Un professeur ne voit que ses cours assignés dans cette classe.
        const assignments = await this.prisma.courseProfessor.findMany({
          where: { userId: actorId, course: { classId } },
          include: { course: true },
        });
        return assignments.map((a) => a.course as CourseContext);
      }

      // Étudiant : vérifie membership, puis voit tous les cours.
      const membership = await this.prisma.classMember.findUnique({
        where: { userId_classId: { userId: actorId, classId } },
        select: { id: true },
      });
      if (!membership) throw new ForbiddenException("Vous n'êtes pas membre de cette classe.");
    }

    // Owner, co-owner, étudiant : tous les cours.
    const courses = await this.prisma.course.findMany({
      where: { classId },
      orderBy: { createdAt: 'asc' },
    });

    return courses as CourseContext[];
  }

  // --------------------------------------------------------------------------
  // Lire un cours (CourseAccessGuard a déjà vérifié l'accès)
  // --------------------------------------------------------------------------

  findOne(ctx: CourseAccessContext): CourseContext {
    return ctx.course;
  }

  // --------------------------------------------------------------------------
  // Modifier un cours (owner/co-owner uniquement — CourseClassOwnerGuard)
  // --------------------------------------------------------------------------

  async update(
    ctx: CourseAccessContext,
    dto: UpdateCourseDto,
    actorId: string,
  ): Promise<CourseContext> {
    // Vérifier unicité du nouveau nom si changement.
    if (dto.name && dto.name !== ctx.course.name) {
      const existing = await this.prisma.course.findFirst({
        where: { classId: ctx.course.classId, name: dto.name, NOT: { id: ctx.course.id } },
        select: { id: true },
      });
      if (existing) {
        throw new ConflictException(`Un cours nommé "${dto.name}" existe déjà dans cette classe.`);
      }
    }

    const updated = await this.prisma.course.update({
      where: { id: ctx.course.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'COURSE_UPDATED',
      targetType: 'Course',
      targetId: ctx.course.id,
      metadata: { changes: Object.keys(dto) },
    });

    return updated as CourseContext;
  }

  // --------------------------------------------------------------------------
  // Supprimer un cours (owner/co-owner uniquement)
  // --------------------------------------------------------------------------

  async remove(ctx: CourseAccessContext, actorId: string): Promise<void> {
    // Vérifier qu'il n'y a pas de documents ou conversations actives
    // (suppression naïve interdite — on force une décision explicite).
    const [docCount, convCount] = await this.prisma.$transaction([
      this.prisma.document.count({
        where: { courseId: ctx.course.id, status: { not: 'DELETED' } },
      }),
      this.prisma.conversation.count({ where: { courseId: ctx.course.id } }),
    ]);

    if (docCount > 0 || convCount > 0) {
      throw new BadRequestException(
        `Ce cours contient ${docCount} document(s) et ${convCount} conversation(s). ` +
        'Supprimez-les ou archivez-les avant de supprimer le cours.',
      );
    }

    await this.prisma.course.delete({ where: { id: ctx.course.id } });

    await this.audit.record({
      actorUserId: actorId,
      action: 'COURSE_DELETED',
      targetType: 'Course',
      targetId: ctx.course.id,
      metadata: { classId: ctx.course.classId, name: ctx.course.name },
    });
  }

  // --------------------------------------------------------------------------
  // Lister les professeurs d'un cours (owner/co-owner ou professeur du cours)
  // --------------------------------------------------------------------------

  async getProfessors(courseId: string) {
    return this.prisma.courseProfessor.findMany({
      where: { courseId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: { assignedAt: 'asc' },
    });
  }

  // --------------------------------------------------------------------------
  // Retirer un professeur d'un cours (owner/co-owner uniquement)
  // --------------------------------------------------------------------------

  async removeProfessor(
    ctx: CourseAccessContext,
    professorId: string,
    actorId: string,
  ): Promise<void> {
    const assignment = await this.prisma.courseProfessor.findUnique({
      where: { userId_courseId: { userId: professorId, courseId: ctx.course.id } },
      select: { id: true },
    });

    if (!assignment) {
      throw new NotFoundException("Ce professeur n'est pas assigné à ce cours.");
    }

    await this.prisma.courseProfessor.delete({
      where: { userId_courseId: { userId: professorId, courseId: ctx.course.id } },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'COURSE_PROFESSOR_REMOVED',
      targetType: 'Course',
      targetId: ctx.course.id,
      metadata: { removedProfessorId: professorId },
    });
  }
}
