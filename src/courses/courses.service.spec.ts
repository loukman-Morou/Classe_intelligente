import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClassStatus, UserRole } from '@prisma/client';
import { CoursesService } from './courses.service';
import { CourseAccessGuard } from './guards/course-access.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CourseAccessContext, CourseContext } from './courses.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER_ID   = 'owner-uuid';
const CO_OWNER_ID = 'coowner-uuid';
const PROF_ID    = 'prof-uuid';
const STUDENT_ID = 'student-uuid';
const OTHER_ID   = 'other-uuid';
const CLASS_ID   = 'class-uuid';
const COURSE_ID  = 'course-uuid';

function makeCourse(overrides: Partial<CourseContext> = {}): CourseContext {
  return {
    id: COURSE_ID, classId: CLASS_ID, name: 'Réseaux',
    description: null, createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeClass(overrides: object = {}) {
  return {
    id: CLASS_ID, status: ClassStatus.ACTIVE,
    ownerId: OWNER_ID, coOwnerId: null, ...overrides,
  };
}

function makeCtx(
  courseRole: CourseAccessContext['courseRole'] = 'CLASS_OWNER',
  userGlobalRole: UserRole = UserRole.STUDENT,
): CourseAccessContext {
  return { course: makeCourse(), courseRole, userGlobalRole };
}

function makeService(overrides: Record<string, unknown> = {}) {
  const prisma = {
    class: { findUnique: jest.fn().mockResolvedValue(makeClass()) },
    course: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(makeCourse()),
      update: jest.fn().mockResolvedValue(makeCourse()),
      delete: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([makeCourse()]),
    },
    classMember: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }),
    },
    courseProfessor: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue({ id: 'cp-1' }),
      delete: jest.fn().mockResolvedValue({}),
    },
    document: { count: jest.fn().mockResolvedValue(0) },
    conversation: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockImplementation((arr: Promise<number>[]) => Promise.all(arr)),
    ...overrides,
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return new CoursesService(prisma, audit);
}

// ---------------------------------------------------------------------------
// CoursesService — création
// ---------------------------------------------------------------------------

describe('CoursesService.create', () => {
  it('crée un cours si acteur est owner', async () => {
    const service = makeService();
    const result = await service.create(CLASS_ID, { name: 'Réseaux' }, OWNER_ID);
    expect(result.classId).toBe(CLASS_ID);
  });

  it('lève ForbiddenException si l\'acteur n\'est pas owner/co-owner', async () => {
    const service = makeService();
    await expect(
      service.create(CLASS_ID, { name: 'Réseaux' }, STUDENT_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lève ConflictException si le nom existe déjà dans la classe', async () => {
    const service = makeService({
      course: { findFirst: jest.fn().mockResolvedValue({ id: 'existing' }) },
    });
    await expect(
      service.create(CLASS_ID, { name: 'Réseaux' }, OWNER_ID),
    ).rejects.toThrow(ConflictException);
  });

  it('lève BadRequestException si la classe n\'est pas ACTIVE', async () => {
    const service = makeService({
      class: { findUnique: jest.fn().mockResolvedValue(makeClass({ status: ClassStatus.ARCHIVED })) },
    });
    await expect(
      service.create(CLASS_ID, { name: 'Réseaux' }, OWNER_ID),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// CoursesService — listage avec isolation par rôle
// ---------------------------------------------------------------------------

describe('CoursesService.findAllForClass — isolation professeur', () => {
  it('STUDENT voit tous les cours de la classe', async () => {
    const service = makeService();
    const result = await service.findAllForClass(CLASS_ID, STUDENT_ID, 'STUDENT');
    expect(result).toHaveLength(1);
  });

  it('PROFESSOR ne voit que ses cours assignés', async () => {
    const assignedCourse = makeCourse({ id: 'assigned-course', name: 'Réseaux' });
    const service = makeService({
      class: { findUnique: jest.fn().mockResolvedValue(makeClass()) },
      courseProfessor: {
        findMany: jest.fn().mockResolvedValue([{ course: assignedCourse }]),
      },
    });
    const result = await service.findAllForClass(CLASS_ID, PROF_ID, 'PROFESSOR');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('assigned-course');
  });

  it('non-membre lève ForbiddenException', async () => {
    const service = makeService({
      classMember: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.findAllForClass(CLASS_ID, OTHER_ID, 'STUDENT'),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// CoursesService — suppression (garde-fous)
// ---------------------------------------------------------------------------

describe('CoursesService.remove', () => {
  it('refuse la suppression si des documents existent', async () => {
    const service = makeService({
      document: { count: jest.fn().mockResolvedValue(3) },
      conversation: { count: jest.fn().mockResolvedValue(0) },
    });
    await expect(service.remove(makeCtx(), OWNER_ID)).rejects.toThrow(BadRequestException);
  });

  it('supprime si aucun document ni conversation', async () => {
    const service = makeService();
    await expect(service.remove(makeCtx(), OWNER_ID)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CourseAccessGuard — isolation d'accès cours/classe
// ---------------------------------------------------------------------------

describe('CourseAccessGuard', () => {
  function makeGuard(prismaOverrides: Record<string, unknown> = {}) {
    const prisma = {
      course: {
        findUnique: jest.fn().mockResolvedValue({
          id: COURSE_ID, classId: CLASS_ID, name: 'Réseaux',
          description: null, createdAt: new Date(), updatedAt: new Date(),
        }),
      },
      class: { findUnique: jest.fn().mockResolvedValue(makeClass()) },
      classMember: { findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }) },
      courseProfessor: { findUnique: jest.fn().mockResolvedValue(null) },
      ...prismaOverrides,
    } as unknown as PrismaService;
    return new CourseAccessGuard(prisma);
  }

  function makeContext(userId: string, role: UserRole, courseId = COURSE_ID) {
    const courseAccessContext: Record<string, unknown> = {};
    const request = {
      user: { userId, role, jti: 'j' },
      params: { courseId },
      courseAccessContext: undefined as unknown,
    };
    Object.defineProperty(request, 'courseAccessContext', {
      set(v: unknown) { courseAccessContext['val'] = v; },
      get() { return courseAccessContext['val']; },
    });
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as import('@nestjs/common').ExecutionContext;
  }

  it('autorise le owner de la classe', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(makeContext(OWNER_ID, UserRole.STUDENT))).resolves.toBe(true);
  });

  it('autorise un STUDENT membre de la classe', async () => {
    const guard = makeGuard();
    await expect(guard.canActivate(makeContext(STUDENT_ID, UserRole.STUDENT))).resolves.toBe(true);
  });

  it('refuse un PROFESSOR sans assignation à ce cours', async () => {
    const guard = makeGuard({
      class: { findUnique: jest.fn().mockResolvedValue(makeClass()) },
      courseProfessor: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(guard.canActivate(makeContext(PROF_ID, UserRole.PROFESSOR))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('autorise un PROFESSOR assigné à CE cours', async () => {
    const guard = makeGuard({
      class: { findUnique: jest.fn().mockResolvedValue(makeClass()) },
      courseProfessor: { findUnique: jest.fn().mockResolvedValue({ id: 'cp-1' }) },
      classMember: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(guard.canActivate(makeContext(PROF_ID, UserRole.PROFESSOR))).resolves.toBe(true);
  });

  it('refuse un user non membre (IDOR cross-class)', async () => {
    const guard = makeGuard({
      class: { findUnique: jest.fn().mockResolvedValue(makeClass()) },
      classMember: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(guard.canActivate(makeContext(OTHER_ID, UserRole.STUDENT))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('lève NotFoundException si le cours n\'existe pas', async () => {
    const guard = makeGuard({
      course: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(guard.canActivate(makeContext(OWNER_ID, UserRole.STUDENT))).rejects.toThrow(
      NotFoundException,
    );
  });
});
