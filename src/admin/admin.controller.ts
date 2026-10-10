import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ClassStatus } from '@prisma/client';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { RequestUser } from '../auth/auth.types';
import { AdminGuard } from './guards/admin.guard';
import { AdminService } from './admin.service';
import { ListAuditLogsDto, ListClassesDto, ListUsersDto } from './dto/admin-query.dto';
import { CreateAdminDto } from './dto/create-admin.dto';

/**
 * Espace administration globale.
 *
 * Toutes les routes sont protégées par :
 *  1. JwtAuthGuard     — token valide
 *  2. AdminGuard       — rechargement DB du rôle (ADMIN réel, non suspendu)
 *
 * Chaque action sensible est auditée dans AdminService.
 * L'ADMIN n'a pas d'accès implicite aux données privées des classes/cours —
 * chaque endpoint expose uniquement ce qui est nécessaire à l'administration.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // --------------------------------------------------------------------------
  // Statistiques globales
  // --------------------------------------------------------------------------

  /** GET /admin/stats — vue d'ensemble de la plateforme */
  @Get('stats')
  getGlobalStats(@CurrentUser() user: RequestUser) {
    return this.adminService.getGlobalStats(user.userId);
  }

  // --------------------------------------------------------------------------
  // Gestion utilisateurs
  // --------------------------------------------------------------------------

  /** GET /admin/users?page=1&limit=20&role=STUDENT&status=ACTIVE&search=dupont */
  @Get('users')
  listUsers(@Query() dto: ListUsersDto, @CurrentUser() user: RequestUser) {
    return this.adminService.listUsers(dto, user.userId);
  }

  /**
   * POST /admin/users/create-admin
   *
   * Crée un nouveau compte ADMIN (plafond MAX_ADMINS respecté).
   * Throttle strict : 3 créations/heure maximum pour limiter l'abus.
   * Toujours audité avec actorId + nouvel adminId.
   */
  @Post('users/create-admin')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { ttl: 3_600_000, limit: 3 } })
  createAdmin(@Body() dto: CreateAdminDto, @CurrentUser() user: RequestUser) {
    return this.adminService.createAdmin(dto, user.userId);
  }

  /**
   * GET /admin/admins
   * Liste les comptes ADMIN (utile pour vérifier le plafond et les actifs).
   * Ne retourne jamais passwordHash.
   */
  @Get('admins')
  listAdmins(@CurrentUser() user: RequestUser) {
    return this.adminService.listUsers(
      { role: 'ADMIN' as import('@prisma/client').UserRole, page: 1, limit: 10 },
      user.userId,
    );
  }

  /** GET /admin/users/:userId — détail d'un utilisateur */
  @Get('users/:userId')
  getUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.adminService.getUser(userId, user.userId);
  }

  /** PATCH /admin/users/:userId/suspend */
  @Patch('users/:userId/suspend')
  suspendUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.adminService.suspendUser(userId, user.userId);
  }

  /** PATCH /admin/users/:userId/reactivate */
  @Patch('users/:userId/reactivate')
  reactivateUser(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.adminService.reactivateUser(userId, user.userId);
  }

  // --------------------------------------------------------------------------
  // Gestion classes
  // --------------------------------------------------------------------------

  /** GET /admin/classes?page=1&limit=20&status=ARCHIVED */
  @Get('classes')
  listClasses(@Query() dto: ListClassesDto, @CurrentUser() user: RequestUser) {
    return this.adminService.listClasses(dto, user.userId);
  }

  /**
   * PATCH /admin/classes/:classId/status/:status
   *
   * Forcer le statut d'une classe (ex : restaurer une classe PENDING_DELETION,
   * forcer DELETED après la période de rétention).
   * Le service protège la transition DELETED (doit passer par PENDING_DELETION).
   */
  @Patch('classes/:classId/status/:status')
  setClassStatus(
    @Param('classId', ParseUUIDPipe) classId: string,
    @Param('status', new ParseEnumPipe(ClassStatus)) status: ClassStatus,
    @CurrentUser() user: RequestUser,
  ) {
    return this.adminService.setClassStatus(classId, status, user.userId);
  }

  // --------------------------------------------------------------------------
  // Audit logs
  // --------------------------------------------------------------------------

  /**
   * GET /admin/audit?page=1&limit=20&action=ADMIN_SUSPEND_USER&actorUserId=...
   *
   * Les logs d'audit sont en lecture seule pour l'admin : jamais de DELETE/PATCH.
   * Pagination obligatoire (max 100 par page, défaut 20).
   */
  @Get('audit')
  listAuditLogs(@Query() dto: ListAuditLogsDto, @CurrentUser() user: RequestUser) {
    return this.adminService.listAuditLogs(dto, user.userId);
  }
}
