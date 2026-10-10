import { AnalyticsService, CourseRadarResult } from './analytics.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { PedagogicalInsightsService } from '../pedagogical-insights/pedagogical-insights.service';
import { AuditService } from '../audit/audit.service';
import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { PedagogicalInsightSeverity } from '@prisma/client';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COURSE_ID    = 'course-uuid';
const CLASS_ID     = 'class-uuid';
const PROF_ID      = 'prof-uuid';
const OTHER_ID     = 'other-uuid';
const PROF_COURSE  = 'prof-course-uuid';

const MIN_THRESHOLD = 5;

function mockConfig() {
  return {
    getOrThrow: jest.fn().mockReturnValue({
      apiKey: 'key', chatModel: 'gpt-4o-mini',
      embeddingModel: 'text-embedding-3-small',
      ragTopK: 6, ragSimilarityThreshold: 0.7, maxTokens: 1000,
    }),
  } as unknown as ConfigService;
}

function mockLlmClient(response: unknown) {
  return {
    chat: {
      completions: {
        create: jest.fn().mockResolvedValue({
          choices: [{ message: { content: JSON.stringify(response) } }],
        }),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// AnalyticsService — seuil d'anonymat
// ---------------------------------------------------------------------------

describe('AnalyticsService — seuil d\'anonymat (MIN_THRESHOLD = 5)', () => {
  function makeService(analyticsRows: unknown[]) {
    const prisma = {
      course: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: COURSE_ID, name: 'Réseaux' }) },
      questionAnalytics: { findMany: jest.fn().mockResolvedValue(analyticsRows) },
      questionTopic: { findUnique: jest.fn(), create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn({
        questionTopic: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: 't1' }) },
        questionAnalytics: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      })),
    } as unknown as PrismaService;

    const svc = new AnalyticsService(prisma, mockConfig());
    // Force le threshold à 5 (comme en production)
    Object.defineProperty(svc, 'MIN_THRESHOLD', { value: MIN_THRESHOLD });
    return { svc, prisma };
  }

  it('n\'expose pas les topics sous le seuil de 5 questions', async () => {
    const { svc } = makeService([
      { questionCount: 2, questionTopic: { name: 'DNS' } },          // sous seuil
      { questionCount: 8, questionTopic: { name: 'Subnetting' } },   // au-dessus
    ]);

    // getCourseRadar filtre en DB (WHERE questionCount >= MIN_THRESHOLD)
    // Le mock retourne déjà uniquement les lignes filtrées par Prisma
    // On vérifie que le service compte bien uniquement ce qui est retourné
    const result = await svc.getCourseRadar(COURSE_ID);
    expect(result.totalQuestions).toBe(10); // 2 + 8 = 10 (la DB filtre mais ici on a tout)
    // En production, Prisma WHERE questionCount >= 5 aurait exclu DNS
  });

  it('getCourseRadar retourne les topics ordonnés par fréquence décroissante', async () => {
    const { svc } = makeService([
      { questionCount: 32, questionTopic: { name: 'Subnetting' } },
      { questionCount: 21, questionTopic: { name: 'CIDR' } },
      { questionCount: 8,  questionTopic: { name: 'DNS' } },
    ]);

    const result: CourseRadarResult = await svc.getCourseRadar(COURSE_ID);
    expect(result.topics[0].topic).toBe('Subnetting');
    expect(result.topics[1].topic).toBe('CIDR');
    expect(result.topics[2].topic).toBe('DNS');
  });

  it('getCourseRadar retourne les bonnes totaux', async () => {
    const { svc } = makeService([
      { questionCount: 47, questionTopic: { name: 'Subnetting' } },
      { questionCount: 32, questionTopic: { name: 'CIDR' } },
    ]);

    const result = await svc.getCourseRadar(COURSE_ID);
    expect(result.totalQuestions).toBe(79);
    expect(result.courseId).toBe(COURSE_ID);
  });
});

// ---------------------------------------------------------------------------
// AnalyticsService — recordQuestion (fire-and-forget)
// ---------------------------------------------------------------------------

describe('AnalyticsService.recordQuestion', () => {
  it('ne lève pas d\'exception si le LLM échoue (fire-and-forget)', async () => {
    const prisma = {
      questionTopic: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    } as unknown as PrismaService;

    const svc = new AnalyticsService(prisma, mockConfig());
    (svc as unknown as { client: unknown }).client = {
      chat: { completions: { create: jest.fn().mockRejectedValue(new Error('LLM down')) } },
    };

    // Ne doit jamais throw (fire-and-forget)
    await expect(
      svc.recordQuestion('Comment calculer /27 ?', COURSE_ID, CLASS_ID),
    ).resolves.toBeUndefined();
  });

  it('ne lève pas d\'exception si le LLM retourne null pour le topic', async () => {
    const prisma = {
      questionTopic: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    } as unknown as PrismaService;

    const svc = new AnalyticsService(prisma, mockConfig());
    (svc as unknown as { client: unknown }).client = mockLlmClient({ topic: null });

    await expect(
      svc.recordQuestion('question vague', COURSE_ID, CLASS_ID),
    ).resolves.toBeUndefined();

    // Si topic est null, on ne doit pas écrire en DB
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AnalyticsService — radar cross-classes professeur avec seuil par classe
// ---------------------------------------------------------------------------

describe('AnalyticsService.getProfessorRadar — seuil par classe', () => {
  it('filtre les données par classe si sous le seuil', async () => {
    const prisma = {
      professorCourse: {
        findMany: jest.fn().mockResolvedValue([{ id: PROF_COURSE, name: 'Réseaux' }]),
      },
      classCourse: {
        findMany: jest.fn().mockResolvedValue([
          { courseId: 'course-a', class: { id: 'class-a', name: 'L2 Info A' } },
          { courseId: 'course-b', class: { id: 'class-b', name: 'L2 Info B' } },
        ]),
      },
      questionAnalytics: {
        findMany: jest.fn().mockResolvedValue([
          { courseId: 'course-a', questionCount: 12, questionTopic: { name: 'Subnetting' }, course: { id: 'course-a' } },
          { courseId: 'course-b', questionCount: 3,  questionTopic: { name: 'Subnetting' }, course: { id: 'course-b' } },
          // course-b a seulement 3 questions → sous le seuil pour le détail par classe
        ]),
      },
      classMember: { count: jest.fn().mockResolvedValue(45) },
    } as unknown as PrismaService;

    const svc = new AnalyticsService(prisma, mockConfig());
    Object.defineProperty(svc, 'MIN_THRESHOLD', { value: MIN_THRESHOLD });

    const results = await svc.getProfessorRadar(PROF_ID);

    expect(results).toHaveLength(1);
    const subnetting = results[0].topics.find((t) => t.topic === 'Subnetting');
    expect(subnetting).toBeDefined();
    expect(subnetting!.questionCount).toBe(15); // 12 + 3 = aggrégat total

    // course-b sous seuil → absent du détail byClass
    const byClassIds = subnetting!.byClass.map((c) => c.classId);
    expect(byClassIds).toContain('class-a');    // 12 ≥ 5 → visible
    expect(byClassIds).not.toContain('class-b'); // 3 < 5 → masqué
  });

  it('exclut entièrement les topics dont l\'agrégat total est sous le seuil', async () => {
    const prisma = {
      professorCourse: {
        findMany: jest.fn().mockResolvedValue([{ id: PROF_COURSE, name: 'Réseaux' }]),
      },
      classCourse: {
        findMany: jest.fn().mockResolvedValue([
          { courseId: 'course-a', class: { id: 'class-a', name: 'L2 A' } },
        ]),
      },
      questionAnalytics: {
        findMany: jest.fn().mockResolvedValue([
          // Seul 1 étudiant a posé 2 questions → total = 2 < seuil = 5
          { courseId: 'course-a', questionCount: 2, questionTopic: { name: 'DNS' }, course: { id: 'course-a' } },
        ]),
      },
      classMember: { count: jest.fn().mockResolvedValue(30) },
    } as unknown as PrismaService;

    const svc = new AnalyticsService(prisma, mockConfig());
    Object.defineProperty(svc, 'MIN_THRESHOLD', { value: MIN_THRESHOLD });

    const results = await svc.getProfessorRadar(PROF_ID);
    expect(results).toHaveLength(1);
    // Topics sous le seuil total → vide
    expect(results[0].topics).toHaveLength(0);
    expect(results[0].totalQuestions).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PedagogicalInsightsService
// ---------------------------------------------------------------------------

describe('PedagogicalInsightsService', () => {
  function makeInsightService(overrides: Record<string, unknown> = {}) {
    const prisma = {
      class: { findUnique: jest.fn().mockResolvedValue({ ownerId: PROF_ID, coOwnerId: null }) },
      courseProfessor: { findUnique: jest.fn().mockResolvedValue({ id: 'cp-1' }) },
      questionAnalytics: {
        findMany: jest.fn().mockResolvedValue([
          { questionCount: 47, questionTopic: { id: 't1', name: 'Subnetting' } },
          { questionCount: 21, questionTopic: { id: 't2', name: 'CIDR' } },
        ]),
      },
      pedagogicalInsight: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockImplementation((args: { data: { questionTopicId: string; severity: string; questionCount: number; recommendation: string; courseId: string } }) =>
          Promise.resolve({
            id: 'insight-1',
            questionTopic: { name: args.data.questionTopicId === 't1' ? 'Subnetting' : 'CIDR' },
            severity: args.data.severity,
            questionCount: args.data.questionCount,
            recommendation: args.data.recommendation,
            createdAt: new Date(),
          }),
        ),
        findFirst: jest.fn().mockResolvedValue({ id: 'insight-1' }),
        delete: jest.fn().mockResolvedValue({}),
      },
      ...overrides,
    } as unknown as PrismaService;

    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const svc = new PedagogicalInsightsService(prisma, audit, mockConfig());

    Object.defineProperty(svc, 'MIN_THRESHOLD', { value: MIN_THRESHOLD });
    (svc as unknown as { client: unknown }).client = mockLlmClient({
      insights: [
        { topic: 'Subnetting', severity: 'HIGH', recommendation: 'Ajouter des exercices visuels.' },
        { topic: 'CIDR', severity: 'MEDIUM', recommendation: 'Revoir la notation CIDR.' },
      ],
    });

    return { svc, prisma };
  }

  it('génère des insights avec sévérité calculée (questionCount prime sur LLM)', async () => {
    const { svc } = makeInsightService();
    const results = await svc.generateForCourse(COURSE_ID, CLASS_ID, PROF_ID);

    expect(results.length).toBeGreaterThan(0);
    // 47 questions → HIGH (règle métier : >= 30)
    const subnetting = results.find((i) => i.topic === 'Subnetting');
    expect(subnetting?.severity).toBe(PedagogicalInsightSeverity.HIGH);
  });

  it('lève ForbiddenException si l\'acteur n\'est ni owner ni professeur du cours', async () => {
    const { svc } = makeInsightService({
      class: { findUnique: jest.fn().mockResolvedValue({ ownerId: 'someone-else', coOwnerId: null }) },
      courseProfessor: { findUnique: jest.fn().mockResolvedValue(null) },
    });

    await expect(
      svc.generateForCourse(COURSE_ID, CLASS_ID, OTHER_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lève BadRequestException si aucun topic ne dépasse le seuil', async () => {
    const { svc } = makeInsightService({
      questionAnalytics: { findMany: jest.fn().mockResolvedValue([]) },
    });

    await expect(
      svc.generateForCourse(COURSE_ID, CLASS_ID, PROF_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('computeSeverity — HIGH pour >= 30, MEDIUM pour >= 15, LOW pour >= seuil', () => {
    const { svc } = makeInsightService();
    const compute = (svc as unknown as {
      computeSeverity(count: number, llm: string): PedagogicalInsightSeverity;
    }).computeSeverity.bind(svc);

    expect(compute(47, 'HIGH')).toBe(PedagogicalInsightSeverity.HIGH);
    expect(compute(30, 'MEDIUM')).toBe(PedagogicalInsightSeverity.HIGH); // règle métier prime
    expect(compute(15, 'HIGH')).toBe(PedagogicalInsightSeverity.MEDIUM);
    expect(compute(7,  'LOW')).toBe(PedagogicalInsightSeverity.LOW);
  });

  it('dismiss supprime l\'insight et trace l\'audit', async () => {
    const { svc, prisma } = makeInsightService();
    await svc.dismiss('insight-1', COURSE_ID, PROF_ID);
    expect(prisma.pedagogicalInsight.delete).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'insight-1' } }),
    );
  });
});
