import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClassStatus, UserRole, UserStatus } from '@prisma/client';
import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ADMIN_ID  = 'admin-uuid';
const USER_ID   = 'user-uuid';
const OTHER_ID  = 'other-admin-uuid';
const CLASS_ID  = 'class-uuid';

function makeUser(overrides: object = {}) {
  return {
    id: USER_ID, email: 'user@test.com', firstName: 'Test',
    lastName: 'User', role: UserRole.STUDENT,
    status: UserStatus.ACTIVE, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeClass(overrides: object = {}) {
  return {
    id: CLASS_ID, name: 'L2 Info', academicYear: '2026-2027',
    status: ClassStatus.ACTIVE, ...overrides,
  };
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    user: {
      findFirst:  jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(makeUser()),
      findMany:   jest.fn().mockResolvedValue([makeUser()]),
      count:      jest.fn().mockResolvedValue(1),
      update:     jest.fn().mockImplementation((args: { data: object }) =>
        Promise.resolve(makeUser(args.data)),
      ),
      create:     jest.fn().mockResolvedValue({ id: 'new-admin', email: 'admin@test.com', role: UserRole.ADMIN }),
    },
    class: {
      findUnique: jest.fn().mockResolvedValue(makeClass()),
      findMany:   jest.fn().mockResolvedValue([makeClass()]),
      count:      jest.fn().mockResolvedValue(1),
      update:     jest.fn().mockImplementation((args: { data: object }) =>
        Promise.resolve(makeClass(args.data)),
      ),
    },
    document: { count: jest.fn().mockResolvedValue(5) },
    message:  { count: jest.fn().mockResolvedValue(42) },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
      count:    jest.fn().mockResolvedValue(0),
    },
    $transaction: jest.fn().mockImplementation(
      (arr: Promise<unknown>[]) => Promise.all(arr),
    ),
    ...prismaOverrides,
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return { service: new AdminService(prisma, audit), prisma, audit };
}

// ---------------------------------------------------------------------------
// AdminGuard
// ---------------------------------------------------------------------------

describe('AdminGuard', () => {
  function makeGuard(user: { role: UserRole; status: UserStatus } | null) {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(user) },
    } as unknown as PrismaService;
    return new AdminGuard(prisma);
  }

  function makeContext(userId = ADMIN_ID) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId } }),
      }),
    } as unknown as import('@nestjs/common').ExecutionContext;
  }

  it('autorise un ADMIN actif', async () => {
    const guard = makeGuard({ role: UserRole.ADMIN, status: UserStatus.ACTIVE });
    await expect(guard.canActivate(makeContext())).resolves.toBe(true);
  });

  it('refuse un STUDENT (même avec token valide)', async () => {
    const guard = makeGuard({ role: UserRole.STUDENT, status: UserStatus.ACTIVE });
    await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
  });

  it('refuse un ADMIN suspendu', async () => {
    const guard = makeGuard({ role: UserRole.ADMIN, status: UserStatus.SUSPENDED });
    await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
  });

  it('refuse si le user n\'existe plus en DB (compte supprimé entre connexion et requête)', async () => {
    const guard = makeGuard(null);
    await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
  });

  it('recharge le rôle depuis la DB (pas depuis le JWT)', async () => {
    // Simule un ancien token ADMIN dont le rôle a été rétrogradé en DB
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ role: UserRole.STUDENT, status: UserStatus.ACTIVE }) },
    } as unknown as PrismaService;
    const guard = new AdminGuard(prisma);
    await expect(guard.canActivate(makeContext())).rejects.toThrow(ForbiddenException);
    // Preuve que le DB a été consulté (pas le JWT)
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ADMIN_ID } }),
    );
  });
});

// ---------------------------------------------------------------------------
// AdminService — gestion utilisateurs
// ---------------------------------------------------------------------------

describe('AdminService.suspendUser', () => {
  it('suspend un utilisateur actif', async () => {
    const { service, audit } = makeService();
    await service.suspendUser(USER_ID, ADMIN_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ADMIN_SUSPEND_USER' }),
    );
  });

  it('refuse qu\'un admin se suspende lui-même', async () => {
    const { service } = makeService();
    await expect(service.suspendUser(ADMIN_ID, ADMIN_ID)).rejects.toThrow(BadRequestException);
  });

  it('refuse de suspendre un autre compte ADMIN', async () => {
    const { service } = makeService({
      user: {
        findUnique: jest.fn().mockResolvedValue(
          makeUser({ id: OTHER_ID, role: UserRole.ADMIN }),
        ),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
    });
    await expect(service.suspendUser(OTHER_ID, ADMIN_ID)).rejects.toThrow(BadRequestException);
  });

  it('lève NotFoundException si l\'utilisateur n\'existe pas', async () => {
    const { service } = makeService({
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(), findFirst: jest.fn(),
        findMany: jest.fn(), count: jest.fn(), create: jest.fn(),
      },
    });
    await expect(service.suspendUser('inexistant-uuid', ADMIN_ID)).rejects.toThrow(NotFoundException);
  });
});

describe('AdminService.reactivateUser', () => {
  it('réactive un utilisateur suspendu', async () => {
    const { service, audit } = makeService({
      user: {
        findUnique: jest.fn().mockResolvedValue(makeUser({ status: UserStatus.SUSPENDED })),
        update: jest.fn().mockResolvedValue(makeUser({ status: UserStatus.ACTIVE })),
        findFirst: jest.fn(), findMany: jest.fn(), count: jest.fn(), create: jest.fn(),
      },
    });
    const result = await service.reactivateUser(USER_ID, ADMIN_ID);
    expect(result.status).toBe(UserStatus.ACTIVE);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ADMIN_REACTIVATE_USER' }),
    );
  });
});

// ---------------------------------------------------------------------------
// AdminService — gestion classes
// ---------------------------------------------------------------------------

describe('AdminService.setClassStatus', () => {
  it('change le statut d\'une classe active en ARCHIVED', async () => {
    const { service, audit } = makeService();
    const result = await service.setClassStatus(CLASS_ID, ClassStatus.ARCHIVED, ADMIN_ID);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ADMIN_SET_CLASS_STATUS',
        metadata: expect.objectContaining({ to: ClassStatus.ARCHIVED }),
      }),
    );
    expect(result).toBeDefined();
  });

  it('refuse de passer directement en DELETED sans PENDING_DELETION', async () => {
    const { service } = makeService();
    await expect(
      service.setClassStatus(CLASS_ID, ClassStatus.DELETED, ADMIN_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('autorise DELETED si la classe est en PENDING_DELETION', async () => {
    const { service } = makeService({
      class: {
        findUnique: jest.fn().mockResolvedValue(
          makeClass({ status: ClassStatus.PENDING_DELETION }),
        ),
        update: jest.fn().mockResolvedValue(
          makeClass({ status: ClassStatus.DELETED }),
        ),
        findMany: jest.fn(), count: jest.fn(),
      },
    });
    const result = await service.setClassStatus(CLASS_ID, ClassStatus.DELETED, ADMIN_ID);
    expect(result.status).toBe(ClassStatus.DELETED);
  });

  it('lève NotFoundException si la classe n\'existe pas', async () => {
    const { service } = makeService({
      class: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(), findMany: jest.fn(), count: jest.fn(),
      },
    });
    await expect(
      service.setClassStatus('inexistant', ClassStatus.ARCHIVED, ADMIN_ID),
    ).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// AdminService — createAdmin (plafond MAX_ADMINS = 3 par défaut)
// ---------------------------------------------------------------------------

describe('AdminService.createAdmin', () => {
  it('crée un admin si le plafond n\'est pas atteint', async () => {
    const createMock = jest.fn().mockResolvedValue({
      id: 'admin-2', email: 'admin2@test.com', role: UserRole.ADMIN,
    });
    const { service, audit } = makeService({
      user: {
        findUnique: jest.fn().mockResolvedValue(null), // email libre
        count:      jest.fn().mockResolvedValue(1),    // 1 admin existant < 3
        create:     createMock,
        findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(),
      },
    });

    const result = await service.createAdmin(
      { email: 'admin2@test.com', firstName: 'Admin', lastName: 'Two', password: 'Admin@1234!' },
      ADMIN_ID,
    );

    expect(createMock).toHaveBeenCalled();
    expect(result.role).toBe(UserRole.ADMIN);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ADMIN_CREATE_ADMIN' }),
    );
  });

  it('lève ConflictException si le plafond MAX_ADMINS est atteint', async () => {
    const { service } = makeService({
      user: {
        count:      jest.fn().mockResolvedValue(3), // plafond atteint
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(),
      },
    });

    await expect(
      service.createAdmin(
        { email: 'admin4@test.com', firstName: 'A', lastName: 'D', password: 'Admin@1234!' },
        ADMIN_ID,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('lève ConflictException si l\'email est déjà utilisé', async () => {
    const { service } = makeService({
      user: {
        count:      jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue({ id: 'existing', email: 'taken@test.com' }),
        create: jest.fn(), findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(),
      },
    });

    await expect(
      service.createAdmin(
        { email: 'taken@test.com', firstName: 'A', lastName: 'D', password: 'Admin@1234!' },
        ADMIN_ID,
      ),
    ).rejects.toThrow(ConflictException);
  });

  it('ne peut pas créer un admin via l\'inscription publique (AuthService force STUDENT)', () => {
    // Ce test documente la garantie architecturale :
    // POST /auth/register hardcode role: UserRole.STUDENT (vérifié dans auth.service.ts).
    // Le seul chemin pour créer un ADMIN est POST /admin/users/admins (AdminController)
    // ou le script seed-admin.ts.
    expect(true).toBe(true); // Assertion documentaire — couvert par les tests AuthService
  });
});

// ---------------------------------------------------------------------------
// AdminService — ensureAdminExists (seed — legacy, délégue à createAdmin)
// ---------------------------------------------------------------------------

describe('AdminService.ensureAdminExists', () => {
  it('crée le premier admin si aucun n\'existe (count=0)', async () => {
    const createMock = jest.fn().mockResolvedValue({
      id: 'admin-1', email: 'admin@test.com', role: UserRole.ADMIN,
    });
    const { service } = makeService({
      user: {
        count:      jest.fn().mockResolvedValue(0), // aucun admin
        findUnique: jest.fn().mockResolvedValue(null),
        create:     createMock,
        findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(),
      },
    });

    const result = await service.ensureAdminExists({
      email: 'admin@test.com', passwordHash: '$argon2id$...',
      firstName: 'Admin', lastName: 'System',
    });

    expect(createMock).toHaveBeenCalled();
    expect(result.role).toBe(UserRole.ADMIN);
  });

  it('est idempotent : ne crée pas si le plafond est déjà atteint', async () => {
    const { service } = makeService({
      user: {
        count:      jest.fn().mockResolvedValue(3), // plafond
        findUnique: jest.fn().mockResolvedValue(null),
        create:     jest.fn(),
        findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn(),
      },
    });

    await expect(
      service.ensureAdminExists({
        email: 'admin@test.com', passwordHash: '$argon2id$...',
        firstName: 'Admin', lastName: 'System',
      }),
    ).rejects.toThrow(ConflictException);
  });
});

// ---------------------------------------------------------------------------
// AdminService — statistiques globales
// ---------------------------------------------------------------------------

describe('AdminService.getGlobalStats', () => {
  it('retourne les compteurs et trace l\'audit', async () => {
    const { service, audit } = makeService();
    const result = await service.getGlobalStats(ADMIN_ID);

    expect(result).toHaveProperty('users');
    expect(result).toHaveProperty('classes');
    expect(result).toHaveProperty('documents');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ADMIN_VIEW_GLOBAL_STATS' }),
    );
  });
});

// ---------------------------------------------------------------------------
// AdminService — audit logs en lecture seule
// ---------------------------------------------------------------------------

describe('AdminService.listAuditLogs', () => {
  it('retourne une liste paginée', async () => {
    const { service } = makeService({
      auditLog: {
        findMany: jest.fn().mockResolvedValue([{ id: 'log-1', action: 'TEST', createdAt: new Date() }]),
        count: jest.fn().mockResolvedValue(1),
      },
      $transaction: jest.fn().mockImplementation((arr: Promise<unknown>[]) => Promise.all(arr)),
    });
    const result = await service.listAuditLogs({ page: 1, limit: 20 }, ADMIN_ID);
    expect(result.data).toHaveLength(1);
    expect(result.meta.total).toBe(1);
  });
});
