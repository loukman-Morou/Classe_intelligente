import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { SetCoOwnerDto } from './dto/set-co-owner.dto';
import { ClassContext } from './classes.types';

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------------
  // Créer une classe
  // --------------------------------------------------------------------------

  async create(dto: CreateClassDto, actorId: string): Promise<ClassContext> {
    const joinCode = await this.generateUniqueJoinCode();

    // Transaction : création de la classe + inscription du créateur comme membre
    // en une seule opération atomique — cohérence garantie même si le process
    // est interrompu entre les deux.
    const cls = await this.prisma.$transaction(async (tx) => {
      const created = await tx.class.create({
        data: {
          name: dto.name,
          academicYear: dto.academicYear,
          description: dto.description ?? null,
          ownerId: actorId,
          joinCode,
        },
      });

      // Le owner est aussi un ClassMember pour apparaître dans la liste des membres
      // et accéder aux cours (invariant applicatif maintenu à la création).
      await tx.classMember.create({
        data: { userId: actorId, classId: created.id },
      });

      return created;
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'CLASS_CREATED',
      targetType: 'Class',
      targetId: cls.id,
      metadata: { name: cls.name, academicYear: cls.academicYear },
    });

    return cls as ClassContext;
  }

  // --------------------------------------------------------------------------
  // Lire une classe (le guard ClassMemberGuard a déjà vérifié l'accès)
  // --------------------------------------------------------------------------

  findOne(classContext: ClassContext): ClassContext {
    return classContext;
  }

  // --------------------------------------------------------------------------
  // Lister les classes du user connecté
  // --------------------------------------------------------------------------

  async findAllForUser(userId: string): Promise<ClassContext[]> {
    // Requête consolidée : classes dont le user est owner, co-owner, ou membre.
    const classes = await this.prisma.class.findMany({
      where: {
        status: { not: ClassStatus.DELETED },
        OR: [
          { ownerId: userId },
          { coOwnerId: userId },
          { members: { some: { userId } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    return classes as ClassContext[];
  }

  // --------------------------------------------------------------------------
  // Modifier une classe (owner ou co-owner uniquement — guard déjà passé)
  // --------------------------------------------------------------------------

  async update(
    classContext: ClassContext,
    dto: UpdateClassDto,
    actorId: string,
  ): Promise<ClassContext> {
    if (classContext.status !== ClassStatus.ACTIVE) {
      throw new BadRequestException('Seule une classe ACTIVE peut être modifiée.');
    }

    const updated = await this.prisma.class.update({
      where: { id: classContext.id },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.academicYear !== undefined && { academicYear: dto.academicYear }),
        ...(dto.description !== undefined && { description: dto.description }),
      },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'CLASS_UPDATED',
      targetType: 'Class',
      targetId: classContext.id,
      metadata: { changes: Object.keys(dto) },
    });

    return updated as ClassContext;
  }

  // --------------------------------------------------------------------------
  // Rejoindre une classe via code court
  // --------------------------------------------------------------------------

  async join(joinCode: string, userId: string): Promise<{ message: string }> {
    const cls = await this.prisma.class.findUnique({
      where: { joinCode },
      select: { id: true, status: true, ownerId: true },
    });

    if (!cls || cls.status !== ClassStatus.ACTIVE) {
      // Message volontairement vague : ne pas confirmer si le code existe mais
      // la classe est archivée (info inutile pour un attaquant, inutile tout court).
      throw new NotFoundException('Code de classe invalide ou classe inactive.');
    }

    try {
      await this.prisma.classMember.create({
        data: { userId, classId: cls.id },
      });
    } catch (error: unknown) {
      // Unique constraint violation (userId, classId) = déjà membre.
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('Vous êtes déjà membre de cette classe.');
      }
      throw error;
    }

    await this.audit.record({
      actorUserId: userId,
      action: 'CLASS_JOINED',
      targetType: 'Class',
      targetId: cls.id,
    });

    return { message: 'Vous avez rejoint la classe avec succès.' };
  }

  // --------------------------------------------------------------------------
  // Lister les membres (guard ClassMemberGuard déjà passé)
  // --------------------------------------------------------------------------

  async getMembers(classId: string, page: number, limit: number) {
    const [members, total] = await this.prisma.$transaction([
      this.prisma.classMember.findMany({
        where: { classId },
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true, role: true },
          },
        },
        orderBy: { joinedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.classMember.count({ where: { classId } }),
    ]);

    return {
      data: members,
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  // --------------------------------------------------------------------------
  // Attribuer le co-responsable (owner uniquement, atomique)
  // --------------------------------------------------------------------------

  async setCoOwner(
    classContext: ClassContext,
    dto: SetCoOwnerDto,
    actorId: string,
  ): Promise<ClassContext> {
    // Seul l'owner (pas le co-owner) peut promouvoir quelqu'un.
    if (classContext.ownerId !== actorId) {
      throw new ForbiddenException("Seul le responsable principal peut définir un co-responsable.");
    }

    // Le candidat ne peut pas être le owner lui-même.
    if (dto.userId === actorId) {
      throw new BadRequestException('Le responsable principal ne peut pas être son propre co-responsable.');
    }

    // Vérifier que le candidat est membre de la classe.
    const membership = await this.prisma.classMember.findUnique({
      where: { userId_classId: { userId: dto.userId, classId: classContext.id } },
      select: { id: true },
    });
    if (!membership) {
      throw new BadRequestException("Cet utilisateur n'est pas membre de la classe.");
    }

    // Mise à jour CONDITIONNELLE ATOMIQUE : ne s'exécute que si coOwnerId est NULL.
    // Évite la race condition "deux requêtes simultanées remplissent le créneau" sans
    // SELECT + UPDATE séparés (voir docs/database.md §Concurrence).
    const updated = await this.prisma.class.updateMany({
      where: { id: classContext.id, coOwnerId: null },
      data: { coOwnerId: dto.userId },
    });

    if (updated.count === 0) {
      // Le créneau était déjà pris entre le guard et ici, ou le champ n'était pas NULL.
      throw new ConflictException(
        'La classe a déjà un co-responsable. Retirez-le d'abord.',
      );
    }

    await this.audit.record({
      actorUserId: actorId,
      action: 'CLASS_CO_OWNER_SET',
      targetType: 'Class',
      targetId: classContext.id,
      metadata: { newCoOwnerId: dto.userId },
    });

    const refreshed = await this.prisma.class.findUniqueOrThrow({ where: { id: classContext.id } });
    return refreshed as ClassContext;
  }

  // --------------------------------------------------------------------------
  // Retirer le co-responsable (owner uniquement, idempotent)
  // --------------------------------------------------------------------------

  async removeCoOwner(classContext: ClassContext, actorId: string): Promise<ClassContext> {
    if (classContext.ownerId !== actorId) {
      throw new ForbiddenException("Seul le responsable principal peut retirer le co-responsable.");
    }

    await this.prisma.class.update({
      where: { id: classContext.id },
      data: { coOwnerId: null },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'CLASS_CO_OWNER_REMOVED',
      targetType: 'Class',
      targetId: classContext.id,
      metadata: { previousCoOwnerId: classContext.coOwnerId },
    });

    const refreshed = await this.prisma.class.findUniqueOrThrow({ where: { id: classContext.id } });
    return refreshed as ClassContext;
  }

  // --------------------------------------------------------------------------
  // Retirer un membre (owner ou co-owner, ne peut pas s'appliquer à l'owner lui-même)
  // --------------------------------------------------------------------------

  async removeMember(classContext: ClassContext, targetUserId: string, actorId: string): Promise<void> {
    if (targetUserId === classContext.ownerId) {
      throw new BadRequestException(
        'Le responsable principal ne peut pas être retiré de sa propre classe.',
      );
    }

    // Si le membre retiré est le co-owner, libérer aussi ce créneau.
    if (targetUserId === classContext.coOwnerId) {
      await this.prisma.class.update({
        where: { id: classContext.id },
        data: { coOwnerId: null },
      });
    }

    const deleted = await this.prisma.classMember.deleteMany({
      where: { userId: targetUserId, classId: classContext.id },
    });

    if (deleted.count === 0) {
      throw new NotFoundException("Cet utilisateur n'est pas membre de la classe.");
    }

    await this.audit.record({
      actorUserId: actorId,
      action: 'CLASS_MEMBER_REMOVED',
      targetType: 'Class',
      targetId: classContext.id,
      metadata: { removedUserId: targetUserId },
    });
  }

  // --------------------------------------------------------------------------
  // Archiver une classe (owner uniquement)
  // --------------------------------------------------------------------------

  async archive(classContext: ClassContext, actorId: string): Promise<ClassContext> {
    // Seul le owner (pas le co-owner) peut archiver : action irréversible
    // via l'API publique (restauration = admin uniquement, Phase 12).
    if (classContext.ownerId !== actorId) {
      throw new ForbiddenException("Seul le responsable principal peut archiver la classe.");
    }

    if (classContext.status === ClassStatus.ARCHIVED) {
      throw new BadRequestException('La classe est déjà archivée.');
    }
    if (classContext.status !== ClassStatus.ACTIVE && classContext.status !== ClassStatus.INACTIVE) {
      throw new BadRequestException('Seules les classes ACTIVE ou INACTIVE peuvent être archivées.');
    }

    const archived = await this.prisma.class.update({
      where: { id: classContext.id },
      data: { status: ClassStatus.ARCHIVED },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'CLASS_ARCHIVED',
      targetType: 'Class',
      targetId: classContext.id,
    });

    return archived as ClassContext;
  }

  // --------------------------------------------------------------------------
  // Restaurer une classe ARCHIVED → ACTIVE (owner uniquement pour Phase 3,
  // admin en Phase 12)
  // --------------------------------------------------------------------------

  async restore(classContext: ClassContext, actorId: string): Promise<ClassContext> {
    if (classContext.ownerId !== actorId) {
      throw new ForbiddenException("Seul le responsable principal peut restaurer la classe.");
    }

    if (classContext.status !== ClassStatus.ARCHIVED) {
      throw new BadRequestException('Seule une classe ARCHIVED peut être restaurée.');
    }

    const restored = await this.prisma.class.update({
      where: { id: classContext.id },
      data: { status: ClassStatus.ACTIVE },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'CLASS_RESTORED',
      targetType: 'Class',
      targetId: classContext.id,
    });

    return restored as ClassContext;
  }

  // --------------------------------------------------------------------------
  // Dashboard (stats rapides — guard ClassMemberGuard déjà passé)
  // --------------------------------------------------------------------------

  async getDashboard(classId: string) {
    const [students, courses, documents, questions] = await this.prisma.$transaction([
      this.prisma.classMember.count({ where: { classId } }),
      this.prisma.course.count({ where: { classId } }),
      this.prisma.document.count({
        where: { course: { classId }, status: { not: 'DELETED' } },
      }),
      this.prisma.message.count({
        where: { role: 'USER', conversation: { courseId: { in:
          (await this.prisma.course.findMany({ where: { classId }, select: { id: true } }))
            .map((c) => c.id),
        } } },
      }),
    ]);

    return { students, courses, documents, questions };
  }

  // --------------------------------------------------------------------------
  // Helper privé : génère un code joinCode unique (8 chars alphanumériques)
  // --------------------------------------------------------------------------

  private async generateUniqueJoinCode(): Promise<string> {
    const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // sans 0/O/1/I pour lisibilité
    const MAX_ATTEMPTS = 10;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const code = Array.from(randomBytes(8))
        .map((b) => CHARS[b % CHARS.length])
        .join('');

      const exists = await this.prisma.class.findUnique({
        where: { joinCode: code },
        select: { id: true },
      });

      if (!exists) return code;
    }

    // Avec 32^8 ≈ 10^12 combinaisons, arriver ici nécessiterait des centaines
    // de milliards de classes — en pratique impossible, mais on défend contre
    // l'erreur de code ou un alphabet trop petit.
    throw new Error('Impossible de générer un joinCode unique après 10 tentatives.');
  }
}
