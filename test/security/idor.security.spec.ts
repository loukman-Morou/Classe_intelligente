/**
 * Tests IDOR / BOLA — Phase 14 : Durcissement sécurité
 *
 * Principe : pour chaque type de ressource, on vérifie qu'un utilisateur
 * ne peut jamais accéder à une ressource qui ne lui appartient pas en
 * modifiant manuellement l'identifiant dans l'URL.
 *
 * Ces tests sont des tests unitaires (mocks) pour ne pas dépendre d'une DB.
 * Les tests e2e de bout en bout sont dans test/auth.e2e-spec.ts.
 */

import { ExecutionContext, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ClassStatus, UserRole, UserStatus } from '@prisma/client';
import { ClassMemberGuard } from '../../src/classes/guards/class-member.guard';
import { ClassOwnerGuard } from '../../src/classes/guards/class-owner.guard';
import { CourseAccessGuard } from '../../src/courses/guards/course-access.guard';
import { AdminGuard } from '../../src/admin/guards/admin.guard';
import { PrismaService } from '../../src/prisma/prisma.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_A   = 'user-a-uuid';
const USER_B   = 'user-b-uuid';
const CLASS_A  = 'class-a-uuid';
const CLASS_B  = 'class-b-uuid';
const COURSE_A = 'course-a-uuid';

function makeRequest(userId: string, params: Record<string, string>, role = UserRole.STUDENT) {
  const attachedCtx: Record<string, unknown> = {};
  const req = {
    user: { userId, role, jti: 'tok-1' },
    params,
    get classContext()  { return attachedCtx['classContext']; },
    set classContext(v: unknown) { attachedCtx['classContext'] = v; },
    get courseAccessContext()  { return attachedCtx['courseAccessContext']; },
    set courseAccessContext(v: unknown) { attachedCtx['courseAccessContext'] = v; },
  };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

// ---------------------------------------------------------------------------
// IDOR — ClassMemberGuard
// ---------------------------------------------------------------------------

describe('IDOR : ClassMemberGuard', () => {
  it('bloque un user qui n\'est pas membre de la classe (cross-class IDOR)', async () => {
    const prisma = {
      class: {
        findUnique: jest.fn().mockResolvedValue({
          id: CLASS_B, ownerId: USER_B, coOwnerId: null, status: ClassStatus.ACTIVE,
        }),
      },
      classMember: {
        findUnique: jest.fn().mockResolvedValue(null), // USER_A pas membre de CLASS_B
      },
    } as unknown as PrismaService;

    const guard = new ClassMemberGuard(prisma);
    const ctx = makeRequest(USER_A, { classId: CLASS_B });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('autorise le propriétaire même s\'il n\'est pas en ClassMember (défense en profondeur)', async () => {
    const prisma = {
      class: {
        findUnique: jest.fn().mockResolvedValue({
          id: CLASS_A, ownerId: USER_A, coOwnerId: null, status: ClassStatus.ACTIVE,
        }),
      },
    } as unknown as PrismaService;

    const guard = new ClassMemberGuard(prisma);
    const ctx = makeRequest(USER_A, { classId: CLASS_A });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('lève NotFoundException pour un classId inexistant (pas de fuite d\'info)', async () => {
    const prisma = {
      class: { findUnique: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;

    const guard = new ClassMemberGuard(prisma);
    // Un attaquant qui énumère des UUIDs ne doit pas savoir si la classe existe.
    // On retourne 404 (pas 403) pour les classes inexistantes.
    await expect(guard.canActivate(makeRequest(USER_A, { classId: 'nonexistent-uuid' })))
      .rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// IDOR — ClassOwnerGuard
// ---------------------------------------------------------------------------

describe('IDOR : ClassOwnerGuard', () => {
  it('bloque un membre qui tente une action owner (élévation de privilège)', async () => {
    const classCtx = {
      id: CLASS_A, ownerId: USER_B, coOwnerId: null, status: ClassStatus.ACTIVE,
      name: 'Test', academicYear: '2026-2027', description: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    // ClassOwnerGuard utilise classContext déjà attaché par ClassMemberGuard
    const prisma = {
      class: { findUnique: jest.fn().mockResolvedValue(classCtx) },
    } as unknown as PrismaService;

    const guard = new ClassOwnerGuard(prisma);
    const ctx = makeRequest(USER_A, { classId: CLASS_A });

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('autorise le co-owner pour les actions owner/co-owner', async () => {
    const classCtx = {
      id: CLASS_A, ownerId: USER_B, coOwnerId: USER_A, status: ClassStatus.ACTIVE,
      name: 'Test', academicYear: '2026-2027', description: null,
      createdAt: new Date(), updatedAt: new Date(),
    };
    const prisma = {
      class: { findUnique: jest.fn().mockResolvedValue(classCtx) },
    } as unknown as PrismaService;

    const guard = new ClassOwnerGuard(prisma);
    const ctx = makeRequest(USER_A, { classId: CLASS_A });

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// IDOR — CourseAccessGuard (isolation professeur)
// ---------------------------------------------------------------------------

describe('IDOR : CourseAccessGuard', () => {
  function makeGuardPrisma(overrides: Record<string, unknown> = {}) {
    return {
      course: {
        findUnique: jest.fn().mockResolvedValue({
          id: COURSE_A, classId: CLASS_A, name: 'Réseaux',
          description: null, createdAt: new Date(), updatedAt: new Date(),
        }),
      },
      class: {
        findUnique: jest.fn().mockResolvedValue({
          id: CLASS_A, ownerId: USER_B, coOwnerId: null,
        }),
      },
      classMember: { findUnique: jest.fn().mockResolvedValue(null) },
      courseProfessor: { findUnique: jest.fn().mockResolvedValue(null) },
      ...overrides,
    } as unknown as PrismaService;
  }

  it('bloque un STUDENT non membre de la classe (cross-class)', async () => {
    const guard = new CourseAccessGuard(makeGuardPrisma());
    const ctx = makeRequest(USER_A, { courseId: COURSE_A }, UserRole.STUDENT);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('bloque un PROFESSOR non assigné au cours (isolation course-level)', async () => {
    const prisma = makeGuardPrisma({
      classMember: { findUnique: jest.fn().mockResolvedValue(null) },
      courseProfessor: { findUnique: jest.fn().mockResolvedValue(null) }, // pas assigné
    });
    const guard = new CourseAccessGuard(prisma);
    const ctx = makeRequest(USER_A, { courseId: COURSE_A }, UserRole.PROFESSOR);
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('autorise un PROFESSOR assigné à CE cours spécifiquement', async () => {
    const prisma = makeGuardPrisma({
      courseProfessor: { findUnique: jest.fn().mockResolvedValue({ id: 'cp-1' }) },
    });
    const guard = new CourseAccessGuard(prisma);
    const ctx = makeRequest(USER_A, { courseId: COURSE_A }, UserRole.PROFESSOR);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('ne retourne jamais 200 pour un courseId inexistant (énumération)', async () => {
    const prisma = makeGuardPrisma({
      course: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    const guard = new CourseAccessGuard(prisma);
    const ctx = makeRequest(USER_A, { courseId: 'fake-course-uuid' }, UserRole.STUDENT);
    await expect(guard.canActivate(ctx)).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// BOLA — AdminGuard (vérification rôle en DB)
// ---------------------------------------------------------------------------

describe('BOLA : AdminGuard — le JWT ne suffit pas', () => {
  it('refuse si le rôle a été rétrogradé en DB après émission du token', async () => {
    // Simuler un token JWT valide avec role=ADMIN, mais la DB dit STUDENT.
    // Ce scénario se produit si l'admin est rétrogradé entre la connexion et la requête.
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: UserRole.STUDENT, status: UserStatus.ACTIVE,
        }),
      },
    } as unknown as PrismaService;

    const guard = new AdminGuard(prisma);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: USER_A, role: UserRole.ADMIN } }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
    // Preuve que la DB a été consultée
    expect(prisma.user.findUnique).toHaveBeenCalled();
  });

  it('refuse si le compte est suspendu même avec un token valide', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          role: UserRole.ADMIN, status: UserStatus.SUSPENDED,
        }),
      },
    } as unknown as PrismaService;

    const guard = new AdminGuard(prisma);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { userId: USER_A, role: UserRole.ADMIN } }),
      }),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });
});
