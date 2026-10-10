import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClassStatus, Prisma, UserRole, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AdminConfig } from '../config/configuration';
import { ListUsersDto, ListClassesDto, ListAuditLogsDto } from './dto/admin-query.dto';

/**
 * Pagination helper — structure de réponse uniforme pour toutes les listes admin.
 */
function paginate<T>(data: T[], total: number, page: number, limit: number) {
  return {
    data,
    meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // --------------------------------------------------------------------------
  // Gestion utilisateurs
  // --------------------------------------------------------------------------

  async listUsers(dto: ListUsersDto, adminId: string) {
    const page  = dto.page  ?? 1;
    const limit = dto.limit ?? 20;
    const skip  = (page - 1) * limit;

    // Construction du filtre de façon explicite : jamais d'injection via
    // des champs bruts du DTO dans une interpolation de chaîne.
    const where: Prisma.UserWhereInput = {
      ...(dto.role   && { role:   dto.role }),
      ...(dto.status && { status: dto.status }),
      ...(dto.search && {
        OR: [
          { email:     { contains: dto.search, mode: 'insensitive' } },
          { firstName: { contains: dto.search, mode: 'insensitive' } },
          { lastName:  { contains: dto.search, mode: 'insensitive' } },
        ],
      }),
    };

    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: {
          id: true, email: true, firstName: true, lastName: true,
          role: true, status: true, createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    // Accès admin aux listes d'utilisateurs : action sensible, toujours auditée.
    await this.audit.record({
      actorUserId: adminId,
      action: 'ADMIN_LIST_USERS',
      targetType: 'User',
      metadata: { filters: { role: dto.role, status: dto.status, search: !!dto.search } },
    });

    return paginate(users, total, page, limit);
  }

  async getUser(userId: string, adminId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, status: true, createdAt: true, updatedAt: true,
        classMemberships: {
          select: {
            classId: true,
            class: { select: { name: true, status: true, academicYear: true } },
            joinedAt: true,
          },
        },
      },
    });

    if (!user) throw new NotFoundException('Utilisateur introuvable.');

    await this.audit.record({
      actorUserId: adminId,
      action: 'ADMIN_VIEW_USER',
      targetType: 'User',
      targetId: userId,
    });

    return user;
  }

  async suspendUser(userId: string, adminId: string) {
    await this.assertUserExists(userId);
    await this.assertNotSelf(userId, adminId);
    await this.assertNotAdmin(userId);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.SUSPENDED },
      select: { id: true, email: true, status: true },
    });

    await this.audit.record({
      actorUserId: adminId,
      action: 'ADMIN_SUSPEND_USER',
      targetType: 'User',
      targetId: userId,
      metadata: { email: updated.email },
    });

    return updated;
  }

  async reactivateUser(userId: string, adminId: string) {
    await this.assertUserExists(userId);
    await this.assertNotSelf(userId, adminId);
    await this.assertNotAdmin(userId);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { status: UserStatus.ACTIVE },
      select: { id: true, email: true, status: true },
    });

    await this.audit.record({
      actorUserId: adminId,
      action: 'ADMIN_REACTIVATE_USER',
      targetType: 'User',
      targetId: userId,
      metadata: { email: updated.email },
    });

    return updated;
  }

  // --------------------------------------------------------------------------
  // Gestion classes
  // --------------------------------------------------------------------------

  async listClasses(dto: ListClassesDto, adminId: string) {
    const page  = dto.page  ?? 1;
    const limit = dto.limit ?? 20;
    const skip  = (page - 1) * limit;

    const where: Prisma.ClassWhereInput = {
      ...(dto.status && { status: dto.status }),
    };

    const [classes, total] = await this.prisma.$transaction([
      this.prisma.class.findMany({
        where,
        select: {
          id: true, name: true, academicYear: true, status: true,
          createdAt: true, updatedAt: true,
          owner: { select: { id: true, email: true, firstName: true, lastName: true } },
          _count: { select: { members: true, courses: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.class.count({ where }),
    ]);

    await this.audit.record({
      actorUserId: adminId,
      action: 'ADMIN_LIST_CLASSES',
      targetType: 'Class',
      metadata: { filters: { status: dto.status } },
    });

    return paginate(classes, total, page, limit);
  }

  /**
   * Forcer le changement de statut d'une classe (ex : restaurer une classe
   * PENDING_DELETION). Action réservée à l'admin — le responsable de classe
   * ne peut archiver/restaurer que via les endpoints /classes/:id/archive|restore.
   */
  async setClassStatus(classId: string, status: ClassStatus, adminId: string) {
    const cls = await this.prisma.class.findUnique({
      where: { id: classId },
      select: { id: true, name: true, status: true },
    });

    if (!cls) throw new NotFoundException('Classe introuvable.');

    // Empêcher d'aller directement en DELETED sans passer par PENDING_DELETION.
    if (
      status === ClassStatus.DELETED &&
      cls.status !== ClassStatus.PENDING_DELETION
    ) {
      throw new BadRequestException(
        'Une classe doit être en PENDING_DELETION avant suppression définitive.',
      );
    }

    const updated = await this.prisma.class.update({
      where: { id: classId },
      data: { status },
      select: { id: true, name: true, status: true },
    });

    await this.audit.record({
      actorUserId: adminId,
      action: 'ADMIN_SET_CLASS_STATUS',
      targetType: 'Class',
      targetId: classId,
      metadata: { from: cls.status, to: status },
    });

    return updated;
  }

  // --------------------------------------------------------------------------
  // Audit logs
  // --------------------------------------------------------------------------

  async listAuditLogs(dto: ListAuditLogsDto, adminId: string) {
    const page  = dto.page  ?? 1;
    const limit = dto.limit ?? 20;
    const skip  = (page - 1) * limit;

    const where: Prisma.AuditLogWhereInput = {
      ...(dto.action       && { action:      { contains: dto.action, mode: 'insensitive' } }),
      ...(dto.actorUserId  && { actorUserId: dto.actorUserId }),
      ...(dto.targetType   && { targetType:  dto.targetType }),
      ...(dto.from || dto.to) && {
        createdAt: {
          ...(dto.from && { gte: new Date(dto.from) }),
          ...(dto.to   && { lte: new Date(dto.to) }),
        },
      },
    };

    const [logs, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: {
          actor: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return paginate(logs, total, page, limit);
  }

  // --------------------------------------------------------------------------
  // Statistiques globales
  // --------------------------------------------------------------------------

  async getGlobalStats(adminId: string) {
    const [
      totalUsers,
      totalStudents,
      totalProfessors,
      activeClasses,
      archivedClasses,
      totalDocuments,
      totalMessages,
    ] = await this.prisma.$transaction([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { role: UserRole.STUDENT } }),
      this.prisma.user.count({ where: { role: UserRole.PROFESSOR } }),
      this.prisma.class.count({ where: { status: ClassStatus.ACTIVE } }),
      this.prisma.class.count({ where: { status: ClassStatus.ARCHIVED } }),
      this.prisma.document.count({ where: { status: { not: 'DELETED' } } }),
      this.prisma.message.count({ where: { role: 'USER' } }),
    ]);

    await this.audit.record({
      actorUserId: adminId,
      action: 'ADMIN_VIEW_GLOBAL_STATS',
      targetType: 'Platform',
    });

    return {
      users: { total: totalUsers, students: totalStudents, professors: totalProfessors },
      classes: { active: activeClasses, archived: archivedClasses },
      documents: { total: totalDocuments },
      messages: { total: totalMessages },
    };
  }

  // --------------------------------------------------------------------------
  // Gestion des comptes ADMIN (plafond configurable MAX_ADMINS, défaut 3)
  // --------------------------------------------------------------------------

  /**
   * Crée un nouveau compte ADMIN via l'interface d'administration.
   *
   * Deux chemins autorisés pour créer un ADMIN :
   *  1. `prisma/seed-admin.ts` — premier ADMIN (bootstrap), sans authentification
   *  2. Cette méthode — ADMINs suivants, via POST /admin/users/create-admin
   *
   * Jamais via POST /auth/register (AuthService rejette explicitement le rôle ADMIN).
   *
   * Le plafond MAX_ADMINS garantit la résilience tout en évitant une prolifération
   * incontrôlée de comptes admin.
   */
  async createAdmin(
    data: { email: string; password: string; firstName: string; lastName: string },
    actorId: string,
  ) {
    const adminConfig = this.config.getOrThrow<AdminConfig>('admin');
    const currentCount = await this.prisma.user.count({
      where: { role: UserRole.ADMIN },
    });

    if (currentCount >= adminConfig.maxAdmins) {
      throw new ConflictException(
        `Le nombre maximum d'administrateurs est atteint (${adminConfig.maxAdmins}). ` +
        'Augmentez MAX_ADMINS ou désactivez un compte admin existant.',
      );
    }

    // Vérifier l'unicité de l'email.
    const existingEmail = await this.prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true },
    });
    if (existingEmail) {
      throw new ConflictException('Un compte avec cet email existe déjà.');
    }

    // Hash Argon2id (mêmes paramètres que l'AuthService).
    const passwordHash = await argon2.hash(data.password, {
      type: argon2.argon2id,
      memoryCost: 64 * 1024,
      timeCost: 3,
      parallelism: 4,
    });

    const admin = await this.prisma.user.create({
      data: {
        email:     data.email,
        firstName: data.firstName,
        lastName:  data.lastName,
        passwordHash,
        role:   UserRole.ADMIN,
        status: UserStatus.ACTIVE,
      },
      select: { id: true, email: true, role: true, createdAt: true },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'ADMIN_CREATE_ADMIN',
      targetType: 'User',
      targetId: admin.id,
      metadata: { email: admin.email },
    });

    return admin;
  }

  /**
   * Utilisé uniquement par le script de seed (bootstrap du premier ADMIN).
   * Vérifie que le plafond n'est pas déjà atteint avant de créer.
   * Idempotent : si un ADMIN existe déjà ET que le plafond est atteint, échoue
   * avec un message clair.
   */
  async ensureAdminExists(data: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
  }) {
    const adminConfig = this.config.getOrThrow<AdminConfig>('admin');
    const currentCount = await this.prisma.user.count({
      where: { role: UserRole.ADMIN },
    });

    if (currentCount >= adminConfig.maxAdmins) {
      throw new ConflictException(
        `Le plafond d'administrateurs est atteint (${currentCount}/${adminConfig.maxAdmins}). ` +
        'Aucune action effectuée.',
      );
    }

    // Idempotence : si cet email admin existe déjà, ne rien faire.
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
      select: { id: true, email: true, role: true },
    });

    if (existing) {
      if (existing.role !== UserRole.ADMIN) {
        throw new ConflictException(
          `L'email ${data.email} est déjà utilisé par un compte non-ADMIN.`,
        );
      }
      // Déjà admin avec cet email → idempotent, on retourne l'existant.
      return existing;
    }

    return this.prisma.user.create({
      data: { ...data, role: UserRole.ADMIN, status: UserStatus.ACTIVE },
      select: { id: true, email: true, role: true },
    });
  }

  // --------------------------------------------------------------------------
  // Helpers privés
  // --------------------------------------------------------------------------

  private async assertUserExists(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable.');
  }

  private async assertNotAdmin(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role === UserRole.ADMIN) {
      throw new BadRequestException(
        'Le compte administrateur ne peut pas être suspendu/réactivé via cette interface.',
      );
    }
  }

  private assertNotSelf(targetId: string, adminId: string): void {
    if (targetId === adminId) {
      throw new BadRequestException(
        "Un administrateur ne peut pas suspendre son propre compte.",
      );
    }
  }
}
