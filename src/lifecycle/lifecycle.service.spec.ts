import { ClassStatus } from '@prisma/client';
import { LifecycleService } from './lifecycle.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLASS_ID   = 'class-uuid';
const OWNER_ID   = 'owner-uuid';
const CO_OWNER_ID = 'coowner-uuid';

const LIFECYCLE_CFG = {
  inactiveAfterDays:        90,
  archiveAfterDays:         180,
  pendingDeletionAfterDays: 365,
  deletedAfterDays:         30,
  cron:                     '0 2 * * *',
};

function daysAgo(days: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function makeClass(overrides: object = {}) {
  return {
    id: CLASS_ID, name: 'L2 Info', ownerId: OWNER_ID, coOwnerId: CO_OWNER_ID,
    lastActivityAt: daysAgo(100), status: ClassStatus.ACTIVE,
    createdAt: daysAgo(200), updatedAt: daysAgo(100),
    ...overrides,
  };
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    class: {
      findMany:   jest.fn().mockResolvedValue([]),
      update:     jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    document: {
      findMany:   jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    documentChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    conversation: {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    message:            { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    quizQuestion:       { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    quiz:               { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    pedagogicalInsight: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    questionAnalytics:  { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    questionTopic:      { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    invitation:         { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    courseProfessor:    { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    course:             { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    classMember:        { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    notification:       { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    $transaction: jest.fn().mockImplementation(
      (fn: (tx: unknown) => Promise<unknown>) => fn({
        conversation:       { updateMany: jest.fn().mockResolvedValue({ count: 0 }), deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        documentChunk:      { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        document:           { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        quizQuestion:       { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        quiz:               { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        pedagogicalInsight: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        questionAnalytics:  { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        questionTopic:      { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        message:            { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        invitation:         { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        courseProfessor:    { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        course:             { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        classMember:        { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        notification:       { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
        class:              { update: jest.fn().mockResolvedValue({}) },
      }),
    ),
    ...prismaOverrides,
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const notifications = { notifyMany: jest.fn().mockResolvedValue(undefined) } as unknown as NotificationsService;
  const storage = { deleteObject: jest.fn().mockResolvedValue(undefined) } as unknown as StorageService;

  const config = {
    getOrThrow: jest.fn().mockReturnValue(LIFECYCLE_CFG),
  } as unknown as ConfigService;

  return { service: new LifecycleService(prisma, audit, notifications, storage, config), prisma, audit, notifications, storage };
}

// ---------------------------------------------------------------------------
// ACTIVE → INACTIVE
// ---------------------------------------------------------------------------

describe('LifecycleService — ACTIVE → INACTIVE', () => {
  it('passe en INACTIVE une classe sans activité depuis > 90j', async () => {
    const inactiveClass = makeClass({ status: ClassStatus.ACTIVE, lastActivityAt: daysAgo(95) });
    const { service, prisma, audit, notifications } = makeService({
      class: {
        findMany: jest.fn()
          .mockResolvedValueOnce([inactiveClass]) // ACTIVE → INACTIVE
          .mockResolvedValue([]),                  // autres transitions
        update:     jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    });

    await service.runAllTransitions();

    expect(prisma.class.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: ClassStatus.INACTIVE } }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLASS_AUTO_INACTIVE' }),
    );
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      [OWNER_ID, CO_OWNER_ID],
      'CLASS_INACTIVE',
      expect.objectContaining({ classId: CLASS_ID }),
    );
  });

  it('ne touche pas une classe active récemment', async () => {
    const { service, prisma } = makeService({
      class: {
        findMany:   jest.fn().mockResolvedValue([]), // aucune classe éligible
        update:     jest.fn(),
        updateMany: jest.fn(),
      },
    });

    await service.runAllTransitions();
    expect(prisma.class.update).not.toHaveBeenCalled();
  });

  it('notifie owner ET co-owner (même si coOwnerId est null)', async () => {
    const clsNoCoOwner = makeClass({ coOwnerId: null, lastActivityAt: daysAgo(95) });
    const { service, notifications } = makeService({
      class: {
        findMany: jest.fn()
          .mockResolvedValueOnce([clsNoCoOwner])
          .mockResolvedValue([]),
        update:     jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    });

    await service.runAllTransitions();

    // notifyMany doit filtrer les null (voir NotificationsService.notifyMany)
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      [OWNER_ID, null],
      'CLASS_INACTIVE',
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// INACTIVE → ARCHIVED
// ---------------------------------------------------------------------------

describe('LifecycleService — INACTIVE → ARCHIVED', () => {
  it('archive une classe inactive depuis > 180j', async () => {
    const inactiveClass = makeClass({ status: ClassStatus.INACTIVE, lastActivityAt: daysAgo(185) });
    const { service, prisma, notifications } = makeService({
      class: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])           // ACTIVE → INACTIVE : rien
          .mockResolvedValueOnce([inactiveClass]) // INACTIVE → ARCHIVED
          .mockResolvedValue([]),
        update:     jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    });

    await service.runAllTransitions();

    expect(prisma.class.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: ClassStatus.ARCHIVED } }),
    );
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      expect.any(Array), 'CLASS_ARCHIVED', expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// ARCHIVED → PENDING_DELETION
// ---------------------------------------------------------------------------

describe('LifecycleService — ARCHIVED → PENDING_DELETION', () => {
  it('passe en PENDING_DELETION après > 365j archivée', async () => {
    const archivedClass = makeClass({
      status: ClassStatus.ARCHIVED, updatedAt: daysAgo(370),
    });
    const { service, prisma, notifications } = makeService({
      class: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])         // ACTIVE → INACTIVE
          .mockResolvedValueOnce([])         // INACTIVE → ARCHIVED
          .mockResolvedValueOnce([archivedClass]) // ARCHIVED → PENDING
          .mockResolvedValue([]),
        update:     jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
    });

    await service.runAllTransitions();

    expect(prisma.class.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: ClassStatus.PENDING_DELETION } }),
    );
    expect(notifications.notifyMany).toHaveBeenCalledWith(
      expect.any(Array), 'CLASS_PENDING_DELETION',
      expect.objectContaining({ deletionInDays: 30 }),
    );
  });
});

// ---------------------------------------------------------------------------
// PENDING_DELETION → DELETED (anonymisation + purge S3)
// ---------------------------------------------------------------------------

describe('LifecycleService — PENDING_DELETION → DELETED', () => {
  it('anonymise les conversations et marque les documents DELETED', async () => {
    const pendingClass = makeClass({
      status: ClassStatus.PENDING_DELETION, updatedAt: daysAgo(35),
    });
    const docs = [
      { id: 'doc-1', storageKey: 'courses/x/doc1.pdf' },
      { id: 'doc-2', storageKey: 'courses/x/doc2.pdf' },
    ];

    // TX mock qui capture les appels
    const convUpdateMany  = jest.fn().mockResolvedValue({ count: 5 });
    const classUpdate     = jest.fn().mockResolvedValue({});
    const docUpdateMany   = jest.fn().mockResolvedValue({ count: 2 });
    const chunkDeleteMany = jest.fn().mockResolvedValue({ count: 10 });

    const { service, audit, storage } = makeService({
      class: {
        findMany: jest.fn()
          .mockResolvedValueOnce([]) // ACTIVE → INACTIVE
          .mockResolvedValueOnce([]) // INACTIVE → ARCHIVED
          .mockResolvedValueOnce([]) // ARCHIVED → PENDING
          .mockResolvedValueOnce([pendingClass]), // PENDING → DELETED
        update:     jest.fn().mockResolvedValue({}),
        updateMany: jest.fn(),
      },
      document: {
        findMany:   jest.fn().mockResolvedValue(docs),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(
        (fn: (tx: unknown) => Promise<unknown>) => fn({
          conversation:       { updateMany: convUpdateMany, deleteMany: jest.fn().mockResolvedValue({}) },
          documentChunk:      { deleteMany: chunkDeleteMany },
          document:           { updateMany: docUpdateMany },
          quizQuestion:       { deleteMany: jest.fn().mockResolvedValue({}) },
          quiz:               { deleteMany: jest.fn().mockResolvedValue({}) },
          pedagogicalInsight: { deleteMany: jest.fn().mockResolvedValue({}) },
          questionAnalytics:  { deleteMany: jest.fn().mockResolvedValue({}) },
          questionTopic:      { deleteMany: jest.fn().mockResolvedValue({}) },
          message:            { deleteMany: jest.fn().mockResolvedValue({}) },
          invitation:         { deleteMany: jest.fn().mockResolvedValue({}) },
          courseProfessor:    { deleteMany: jest.fn().mockResolvedValue({}) },
          course:             { deleteMany: jest.fn().mockResolvedValue({}) },
          classMember:        { deleteMany: jest.fn().mockResolvedValue({}) },
          notification:       { deleteMany: jest.fn().mockResolvedValue({}) },
          class:              { update: classUpdate },
        }),
      ),
    });

    await service.runAllTransitions();

    // Conversations anonymisées
    expect(convUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { isAnonymous: true } }),
    );
    // Chunks supprimés
    expect(chunkDeleteMany).toHaveBeenCalled();
    // Documents marqués DELETED
    expect(docUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DELETED' }) }),
    );
    // Classe passée en DELETED
    expect(classUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: ClassStatus.DELETED } }),
    );
    // Audit tracé
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLASS_AUTO_DELETED' }),
    );
    // Purge S3 lancée (fire-and-forget, 2 documents)
    expect(storage.deleteObject).toHaveBeenCalledTimes(2);
    expect(storage.deleteObject).toHaveBeenCalledWith('courses/x/doc1.pdf');
    expect(storage.deleteObject).toHaveBeenCalledWith('courses/x/doc2.pdf');
  });

  it('audite DELETION_FAILED si la transaction échoue (classe reste PENDING_DELETION)', async () => {
    const pendingClass = makeClass({
      status: ClassStatus.PENDING_DELETION, updatedAt: daysAgo(35),
    });

    const { service, audit } = makeService({
      class: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([pendingClass]),
        update:     jest.fn(),
        updateMany: jest.fn(),
      },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockRejectedValue(new Error('DB timeout')),
    });

    // Ne doit pas lever d'erreur (erreur swallowée par runTransition)
    await expect(service.runAllTransitions()).resolves.toBeUndefined();

    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'CLASS_AUTO_DELETION_FAILED' }),
    );
  });

  it('ne bloque pas les autres transitions si une suppression échoue', async () => {
    // Deux classes PENDING_DELETION : la première lève une erreur, la deuxième doit
    // quand même être traitée.
    const pendingGood = makeClass({ id: 'class-good', status: ClassStatus.PENDING_DELETION, updatedAt: daysAgo(35) });
    const pendingBad  = makeClass({ id: 'class-bad',  status: ClassStatus.PENDING_DELETION, updatedAt: daysAgo(35) });

    let callCount = 0;
    const { service } = makeService({
      class: {
        findMany: jest.fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([pendingBad, pendingGood]),
        update:     jest.fn(),
        updateMany: jest.fn(),
      },
      document: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error('Première transaction échoue');
        // La deuxième réussit
        return Promise.resolve();
      }),
    });

    await expect(service.runAllTransitions()).resolves.toBeUndefined();
    // Les deux transactions ont été tentées
    expect(callCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// touchClass — fire-and-forget, ne bloque jamais
// ---------------------------------------------------------------------------

describe('LifecycleService.touchClass', () => {
  it('met à jour lastActivityAt sur une classe ACTIVE', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 1 });
    const { service } = makeService({
      class: { updateMany: updateManyMock, findMany: jest.fn(), update: jest.fn() },
    });

    await service.touchClass(CLASS_ID);

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: CLASS_ID, status: ClassStatus.ACTIVE },
        data:  expect.objectContaining({ lastActivityAt: expect.any(Date) }),
      }),
    );
  });

  it('ne propage pas l\'erreur si la DB est indisponible', async () => {
    const { service } = makeService({
      class: {
        updateMany: jest.fn().mockRejectedValue(new Error('DB unreachable')),
        findMany: jest.fn(), update: jest.fn(),
      },
    });

    // Ne doit jamais lever d'erreur (fire-and-forget)
    await expect(service.touchClass(CLASS_ID)).resolves.toBeUndefined();
  });

  it('ne modifie pas une classe ARCHIVED (WHERE status: ACTIVE)', async () => {
    const updateManyMock = jest.fn().mockResolvedValue({ count: 0 });
    const { service } = makeService({
      class: { updateMany: updateManyMock, findMany: jest.fn(), update: jest.fn() },
    });

    await service.touchClass(CLASS_ID);

    // Le WHERE inclut status: ACTIVE — une classe ARCHIVED n'est pas mise à jour
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: ClassStatus.ACTIVE }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// runAllTransitions — résilience globale
// ---------------------------------------------------------------------------

describe('LifecycleService.runAllTransitions — résilience', () => {
  it('toutes les transitions tentées même si l\'une lève une erreur', async () => {
    const findManyCalls: string[] = [];
    const { service } = makeService({
      class: {
        findMany: jest.fn().mockImplementation(() => {
          findManyCalls.push('call');
          if (findManyCalls.length === 1) throw new Error('Première transition échoue');
          return Promise.resolve([]);
        }),
        update:     jest.fn(),
        updateMany: jest.fn(),
      },
    });

    await expect(service.runAllTransitions()).resolves.toBeUndefined();
    // Les 4 transitions ont toutes été tentées (Promise.allSettled)
    expect(findManyCalls.length).toBe(4);
  });
});
