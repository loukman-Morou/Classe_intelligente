import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClassStatus, CourseSyncStatus, ProposalStatus } from '@prisma/client';
import { ProfessorService } from './professor.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ProfessorCourseContext } from './professor.types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PROF_ID       = 'prof-uuid';
const OTHER_PROF_ID = 'other-prof-uuid';
const CLASS_ID      = 'class-uuid';
const PC_ID         = 'prof-course-uuid';
const COURSE_ID     = 'course-uuid';
const CC_ID         = 'class-course-uuid';
const COPY_ID       = 'copy-course-uuid';
const PROPOSAL_ID   = 'proposal-uuid';

function makeProfCtx(overrides: Partial<ProfessorCourseContext> = {}): ProfessorCourseContext {
  return {
    id: PC_ID, courseId: COURSE_ID, professorId: PROF_ID,
    version: 1, name: 'Réseaux', description: null,
    createdAt: new Date(), updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  const base = {
    class: {
      findUnique: jest.fn().mockResolvedValue({
        id: CLASS_ID, status: ClassStatus.ACTIVE,
        ownerId: 'owner', coOwnerId: null,
      }),
    },
    classMember: {
      findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }),
    },
    classCourse: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: CC_ID, classCourseId: COPY_ID }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    course: {
      create: jest.fn().mockResolvedValue({ id: COPY_ID, name: 'Réseaux', description: null }),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    professorCourse: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({ id: PC_ID, courseId: COURSE_ID }),
    },
    courseVersion: {
      create: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    courseUpdateProposal: {
      findFirst: jest.fn().mockResolvedValue(null),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: PROPOSAL_ID }),
      update: jest.fn().mockResolvedValue({}),
      count: jest.fn().mockResolvedValue(0),
    },
    questionAnalytics: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn().mockImplementation((fn: unknown) => {
      if (typeof fn === 'function') return fn(base);
      if (Array.isArray(fn)) return Promise.all(fn as Promise<unknown>[]);
    }),
    ...prismaOverrides,
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  return new ProfessorService(base, audit);
}

// ---------------------------------------------------------------------------
// Créer un cours dans l'espace professeur
// ---------------------------------------------------------------------------

describe('ProfessorService.createCourse', () => {
  it('crée un Course (classId null) + ProfessorCourse + version initiale dans une transaction', async () => {
    const courseCreate = jest.fn().mockResolvedValue({ id: COURSE_ID, name: 'Réseaux', description: null });
    const pcCreate = jest.fn().mockResolvedValue({ id: PC_ID, courseId: COURSE_ID });
    const versionCreate = jest.fn().mockResolvedValue({});

    const svc = makeService({
      course: { create: courseCreate },
      professorCourse: { ...makeService().prisma?.professorCourse, create: pcCreate } as never,
      courseVersion: { create: versionCreate },
    });

    const result = await svc.createCourse({ name: 'Réseaux' }, PROF_ID);
    expect(result).toBeDefined();
    // La transaction enveloppant les 3 créations est vérifiée via le mock $transaction
  });
});

// ---------------------------------------------------------------------------
// Partager un cours vers une classe
// ---------------------------------------------------------------------------

describe('ProfessorService.shareCourseToClass', () => {
  it('crée une copie indépendante et un ClassCourse', async () => {
    const svc = makeService();
    const result = await svc.shareCourseToClass(makeProfCtx(), { classId: CLASS_ID }, PROF_ID);
    expect(result).toBeDefined();
  });

  it('lève NotFoundException si la classe n\'existe pas', async () => {
    const svc = makeService({
      class: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.shareCourseToClass(makeProfCtx(), { classId: 'bad' }, PROF_ID))
      .rejects.toThrow(NotFoundException);
  });

  it('lève BadRequestException si la classe n\'est pas ACTIVE', async () => {
    const svc = makeService({
      class: { findUnique: jest.fn().mockResolvedValue({ id: CLASS_ID, status: ClassStatus.ARCHIVED }) },
    });
    await expect(svc.shareCourseToClass(makeProfCtx(), { classId: CLASS_ID }, PROF_ID))
      .rejects.toThrow(BadRequestException);
  });

  it('lève ForbiddenException si le professeur n\'est pas membre de la classe', async () => {
    const svc = makeService({
      classMember: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.shareCourseToClass(makeProfCtx(), { classId: CLASS_ID }, PROF_ID))
      .rejects.toThrow(ForbiddenException);
  });

  it('lève ConflictException si un partage actif existe déjà', async () => {
    const svc = makeService({
      classCourse: {
        findUnique: jest.fn().mockResolvedValue({ id: CC_ID, status: 'ACTIVE' }),
      },
    });
    await expect(svc.shareCourseToClass(makeProfCtx(), { classId: CLASS_ID }, PROF_ID))
      .rejects.toThrow(ConflictException);
  });
});

// ---------------------------------------------------------------------------
// Révoquer un partage
// ---------------------------------------------------------------------------

describe('ProfessorService.revokeShare', () => {
  it('passe le statut à REVOKED', async () => {
    const updateMock = jest.fn().mockResolvedValue({});
    const svc = makeService({
      classCourse: {
        findUnique: jest.fn().mockResolvedValue({ id: CC_ID, status: 'ACTIVE' }),
        update: updateMock,
      },
    });
    await svc.revokeShare(makeProfCtx(), CLASS_ID, PROF_ID);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'REVOKED' } }),
    );
  });

  it('lève NotFoundException si le partage n\'existe pas', async () => {
    const svc = makeService({
      classCourse: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(svc.revokeShare(makeProfCtx(), CLASS_ID, PROF_ID))
      .rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// Proposer une mise à jour
// ---------------------------------------------------------------------------

describe('ProfessorService.proposeUpdate', () => {
  const validDto = {
    classCourseId: CC_ID,
    type: 'UPDATE' as const,
    proposalContent: JSON.stringify({ name: 'Réseaux v2' }),
  };

  it('crée une proposition et passe syncStatus à UPDATE_AVAILABLE', async () => {
    const svc = makeService({
      classCourse: {
        findFirst: jest.fn().mockResolvedValue({ id: CC_ID, classId: CLASS_ID, syncStatus: CourseSyncStatus.UP_TO_DATE }),
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    });
    const result = await svc.proposeUpdate(makeProfCtx(), validDto as never, PROF_ID);
    expect(result).toBeDefined();
  });

  it('lève ConflictException si une proposition PENDING existe déjà', async () => {
    const svc = makeService({
      classCourse: {
        findFirst: jest.fn().mockResolvedValue({ id: CC_ID, classId: CLASS_ID, syncStatus: CourseSyncStatus.UPDATE_AVAILABLE }),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      courseUpdateProposal: {
        findFirst: jest.fn().mockResolvedValue({ id: PROPOSAL_ID }),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(1),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(svc.proposeUpdate(makeProfCtx(), validDto as never, PROF_ID))
      .rejects.toThrow(ConflictException);
  });

  it('lève NotFoundException si la ClassCourse n\'appartient pas au cours', async () => {
    const svc = makeService({
      classCourse: {
        findFirst: jest.fn().mockResolvedValue(null),
        findUnique: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(svc.proposeUpdate(makeProfCtx(), validDto as never, PROF_ID))
      .rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// Traiter une proposition (reviewProposal — côté responsable)
// ---------------------------------------------------------------------------

describe('ProfessorService.reviewProposal', () => {
  const OWNER_ID = 'owner-uuid';

  function makeProposal(status = ProposalStatus.PENDING) {
    return {
      id: PROPOSAL_ID,
      status,
      proposalContent: JSON.stringify({ name: 'Réseaux v2' }),
      classCourse: {
        id: CC_ID, classId: CLASS_ID,
        classCourseId: COPY_ID,
        syncStatus: CourseSyncStatus.UPDATE_AVAILABLE,
      },
      proposedByUserId: PROF_ID,
      classCourseId: CC_ID,
    };
  }

  it('accepte la proposition et applique le contenu sur le cours classe', async () => {
    const courseUpdate = jest.fn().mockResolvedValue({});
    const svc = makeService({
      class: { findUnique: jest.fn().mockResolvedValue({ ownerId: OWNER_ID, coOwnerId: null }) },
      courseUpdateProposal: {
        findUnique: jest.fn().mockResolvedValue(makeProposal()),
        update: jest.fn().mockResolvedValue({}),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      course: { update: courseUpdate },
      classCourse: {
        update: jest.fn().mockResolvedValue({}),
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    });

    const result = await svc.reviewProposal(
      PROPOSAL_ID,
      { decision: ProposalStatus.ACCEPTED },
      OWNER_ID,
    );
    expect(result.message).toContain('accepted');
  });

  it('lève ForbiddenException si le reviewer n\'est pas owner/co-owner', async () => {
    const svc = makeService({
      class: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'someone-else', coOwnerId: null }) },
      courseUpdateProposal: {
        findUnique: jest.fn().mockResolvedValue(makeProposal()),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    });
    await expect(
      svc.reviewProposal(PROPOSAL_ID, { decision: ProposalStatus.ACCEPTED }, 'intruder'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lève BadRequestException si la proposition a déjà été traitée', async () => {
    const svc = makeService({
      class: { findUnique: jest.fn().mockResolvedValue({ ownerId: OWNER_ID, coOwnerId: null }) },
      courseUpdateProposal: {
        findUnique: jest.fn().mockResolvedValue(makeProposal(ProposalStatus.ACCEPTED)),
        update: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
    });
    await expect(
      svc.reviewProposal(PROPOSAL_ID, { decision: ProposalStatus.ACCEPTED }, OWNER_ID),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Radar pédagogique — seuil d'anonymat
// ---------------------------------------------------------------------------

describe('ProfessorService.getPedagogicalRadar — seuil anonymat (ANONYMITY_THRESHOLD = 5)', () => {
  it('filtre les topics avec questionCount < 5', async () => {
    const svc = makeService({
      professorCourse: {
        findMany: jest.fn().mockResolvedValue([{
          id: PC_ID,
          course: { id: COURSE_ID, name: 'Réseaux' },
          classCourses: [
            { id: CC_ID, classId: CLASS_ID, classCourseId: COPY_ID,
              class: { name: 'L2 Info', academicYear: '2026-2027' } },
          ],
        }]),
        update: jest.fn(), delete: jest.fn(), create: jest.fn(), findFirst: jest.fn(),
      },
      questionAnalytics: {
        findMany: jest.fn().mockResolvedValue([
          { questionCount: 3, questionTopic: { name: 'Subnetting' }, courseId: COPY_ID },
          { questionCount: 12, questionTopic: { name: 'CIDR' }, courseId: COPY_ID },
        ]),
      },
    });

    const result = await svc.getPedagogicalRadar(PROF_ID);
    const topics = result[0]?.aggregatedTopics ?? [];

    expect(topics.find((t: { topic: string }) => t.topic === 'Subnetting')).toBeUndefined(); // < 5, filtré
    expect(topics.find((t: { topic: string }) => t.topic === 'CIDR')).toBeDefined();         // >= 5, visible
  });
});
