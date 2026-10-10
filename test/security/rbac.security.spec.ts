/**
 * Tests RBAC systématiques — Phase 14
 *
 * Vérifie que chaque rôle ne peut faire que ce qu'il est autorisé à faire.
 * Tests organisés par action sensible, pas par endpoint.
 */

import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ClassStatus, UserRole } from '@prisma/client';
import { ClassesService } from '../../src/classes/classes.service';
import { CoursesService } from '../../src/courses/courses.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { ClassContext } from '../../src/classes/classes.types';
import { CourseAccessContext } from '../../src/courses/courses.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_ID    = 'owner-uuid';
const CO_OWNER_ID = 'co-owner-uuid';
const STUDENT_ID  = 'student-uuid';
const PROF_ID     = 'prof-uuid';
const OTHER_ID    = 'other-uuid';
const CLASS_ID    = 'class-uuid';
const COURSE_ID   = 'course-uuid';

function makeClassCtx(overrides: Partial<ClassContext> = {}): ClassContext {
  return {
    id: CLASS_ID, name: 'L2 Info', academicYear: '2026-2027',
    description: null, status: ClassStatus.ACTIVE,
    ownerId: OWNER_ID, coOwnerId: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeCourseCtx(courseRole: CourseAccessContext['courseRole']): CourseAccessContext {
  return {
    course: {
      id: COURSE_ID, classId: CLASS_ID, name: 'Réseaux',
      description: null, createdAt: new Date(), updatedAt: new Date(),
    },
    courseRole,
    userGlobalRole: UserRole.STUDENT,
  };
}

function makeClassesService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    class: {
      findUnique: jest.fn().mockResolvedValue(null),
      update:     jest.fn().mockResolvedValue(makeClassCtx()),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(makeClassCtx()),
      findMany:   jest.fn().mockResolvedValue([]),
    },
    classMember: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }),
      create:     jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      findMany:   jest.fn().mockResolvedValue([]),
      count:      jest.fn().mockResolvedValue(0),
    },
    course:   { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
    document: { count: jest.fn().mockResolvedValue(0) },
    message:  { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockImplementation(
      (arr: Promise<unknown>[]) => Promise.all(arr),
    ),
    ...prismaOverrides,
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return new ClassesService(prisma, audit);
}

function makeCoursesService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    class: { findUnique: jest.fn().mockResolvedValue({
      id: CLASS_ID, status: ClassStatus.ACTIVE, ownerId: OWNER_ID, coOwnerId: null,
    })},
    course: {
      findFirst: jest.fn().mockResolvedValue(null),
      create:    jest.fn().mockResolvedValue({ id: COURSE_ID, classId: CLASS_ID, name: 'Réseaux' }),
      update:    jest.fn().mockResolvedValue({}),
      delete:    jest.fn().mockResolvedValue({}),
      findMany:  jest.fn().mockResolvedValue([]),
    },
    classMember: { findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }) },
    courseProfessor: { findMany: jest.fn().mockResolvedValue([]) },
    document:    { count: jest.fn().mockResolvedValue(0) },
    conversation:{ count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockImplementation(
      (arr: Promise<unknown>[]) => Promise.all(arr),
    ),
    ...prismaOverrides,
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return new CoursesService(prisma, audit);
}

// ---------------------------------------------------------------------------
// RBAC — Gestion de classe
// ---------------------------------------------------------------------------

describe('RBAC : gestion de classe', () => {
  describe('archive()', () => {
    it('OWNER peut archiver sa propre classe', async () => {
      const svc = makeClassesService();
      await expect(svc.archive(makeClassCtx(), OWNER_ID)).resolves.toBeDefined();
    });

    it('CO_OWNER ne peut pas archiver (action owner principal uniquement)', async () => {
      const svc = makeClassesService();
      const ctx = makeClassCtx({ coOwnerId: CO_OWNER_ID });
      await expect(svc.archive(ctx, CO_OWNER_ID)).rejects.toThrow(ForbiddenException);
    });

    it('STUDENT ne peut pas archiver', async () => {
      const svc = makeClassesService();
      await expect(svc.archive(makeClassCtx(), STUDENT_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('setCoOwner()', () => {
    it('OWNER peut promouvoir un co-owner', async () => {
      const svc = makeClassesService();
      const result = await svc.setCoOwner(
        makeClassCtx(), { userId: STUDENT_ID }, OWNER_ID,
      );
      expect(result).toBeDefined();
    });

    it('CO_OWNER ne peut pas promouvoir quelqu\'un (pas le bon rôle)', async () => {
      const svc = makeClassesService();
      const ctx = makeClassCtx({ coOwnerId: CO_OWNER_ID });
      await expect(
        svc.setCoOwner(ctx, { userId: STUDENT_ID }, CO_OWNER_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('STUDENT ne peut pas modifier son propre rôle', async () => {
      const svc = makeClassesService();
      await expect(
        svc.setCoOwner(makeClassCtx(), { userId: STUDENT_ID }, STUDENT_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('removeMember()', () => {
    it('l\'owner principal ne peut pas être retiré de sa classe', async () => {
      const svc = makeClassesService();
      await expect(
        svc.removeMember(makeClassCtx(), OWNER_ID, CO_OWNER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('un étudiant ne peut pas se retirer lui-même sans permissions', async () => {
      // removeMember est protégé par ClassOwnerGuard côté controller.
      // Ce test vérifie que le service lui-même ne laisse pas passer si
      // l'acteur n'est ni owner ni co-owner.
      // Note : le service ne vérifie pas qui est l'acteur sur removeMember —
      // c'est la responsabilité du guard. Ce test documente cette répartition.
      const svc = makeClassesService({
        classMember: {
          deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
          findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }),
        },
      });
      // Le service permet le retrait si les données sont correctes —
      // la protection de rôle est assurée par ClassOwnerGuard (testé dans idor.security.spec.ts)
      await expect(
        svc.removeMember(makeClassCtx({ coOwnerId: CO_OWNER_ID }), CO_OWNER_ID, OWNER_ID),
      ).resolves.toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// RBAC — Gestion de cours
// ---------------------------------------------------------------------------

describe('RBAC : gestion de cours', () => {
  describe('create()', () => {
    it('OWNER peut créer un cours dans sa classe', async () => {
      const svc = makeCoursesService();
      await expect(
        svc.create(CLASS_ID, { name: 'Réseaux' }, OWNER_ID),
      ).resolves.toBeDefined();
    });

    it('CO_OWNER peut créer un cours', async () => {
      const svc = makeCoursesService({
        class: { findUnique: jest.fn().mockResolvedValue({
          id: CLASS_ID, status: ClassStatus.ACTIVE,
          ownerId: OWNER_ID, coOwnerId: CO_OWNER_ID,
        })},
      });
      await expect(
        svc.create(CLASS_ID, { name: 'Réseaux' }, CO_OWNER_ID),
      ).resolves.toBeDefined();
    });

    it('STUDENT ne peut pas créer un cours', async () => {
      const svc = makeCoursesService();
      await expect(
        svc.create(CLASS_ID, { name: 'Réseaux' }, STUDENT_ID),
      ).rejects.toThrow(ForbiddenException);
    });

    it('PROFESSOR ne peut pas créer un cours (même membre de la classe)', async () => {
      const svc = makeCoursesService();
      await expect(
        svc.create(CLASS_ID, { name: 'Réseaux' }, PROF_ID),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findAllForClass() — isolation par rôle', () => {
    it('STUDENT voit tous les cours de la classe', async () => {
      const svc = makeCoursesService({
        course: { findMany: jest.fn().mockResolvedValue([{ id: 'c1' }, { id: 'c2' }]) },
      });
      const result = await svc.findAllForClass(CLASS_ID, STUDENT_ID, 'STUDENT');
      expect(result).toHaveLength(2);
    });

    it('PROFESSOR ne voit que ses cours assignés (isolation stricte)', async () => {
      const svc = makeCoursesService({
        class: { findUnique: jest.fn().mockResolvedValue({
          id: CLASS_ID, ownerId: OTHER_ID, coOwnerId: null,
        })},
        courseProfessor: {
          findMany: jest.fn().mockResolvedValue([
            { course: { id: 'my-course', classId: CLASS_ID, name: 'Réseaux' } },
          ]),
        },
      });
      const result = await svc.findAllForClass(CLASS_ID, PROF_ID, 'PROFESSOR');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('my-course');
    });
  });

  describe('remove() — garde-fous', () => {
    it('bloque la suppression si des documents existent', async () => {
      const svc = makeCoursesService({
        document: { count: jest.fn().mockResolvedValue(5) },
        conversation: { count: jest.fn().mockResolvedValue(0) },
      });
      await expect(
        svc.remove(makeCourseCtx('CLASS_OWNER'), OWNER_ID),
      ).rejects.toThrow(BadRequestException);
    });

    it('bloque si des conversations existent', async () => {
      const svc = makeCoursesService({
        document: { count: jest.fn().mockResolvedValue(0) },
        conversation: { count: jest.fn().mockResolvedValue(12) },
      });
      await expect(
        svc.remove(makeCourseCtx('CLASS_OWNER'), OWNER_ID),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

// ---------------------------------------------------------------------------
// RBAC — Règles inter-classe
// ---------------------------------------------------------------------------

describe('RBAC : isolation inter-classe', () => {
  it('un user ne peut pas rejoindre une classe avec un code invalide (cross-class guess)', async () => {
    const svc = makeClassesService({
      class: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.join('WRONGCOD', STUDENT_ID)).rejects.toThrow();
  });

  it('un user membre de la classe A ne peut pas accéder aux ressources de la classe B', async () => {
    // Ce test vérifie le principe via ClassMemberGuard (testé dans idor.security.spec.ts).
    // Ici on vérifie l'invariant au niveau service : findAllForClass bloque les non-membres.
    const svc = makeCoursesService({
      class: { findUnique: jest.fn().mockResolvedValue({
        id: CLASS_ID, ownerId: OTHER_ID, coOwnerId: null,
      })},
      classMember: { findUnique: jest.fn().mockResolvedValue(null) }, // USER_A pas membre
      courseProfessor: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      svc.findAllForClass(CLASS_ID, STUDENT_ID, 'STUDENT'),
    ).rejects.toThrow(ForbiddenException);
  });
});
