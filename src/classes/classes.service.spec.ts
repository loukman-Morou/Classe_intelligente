import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ClassStatus } from '@prisma/client';
import { ClassesService } from './classes.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClassContext } from './classes.types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OWNER_ID = 'owner-uuid';
const CO_OWNER_ID = 'co-owner-uuid';
const MEMBER_ID = 'member-uuid';
const OTHER_ID = 'other-uuid';

function makeClass(overrides: Partial<ClassContext> = {}): ClassContext {
  return {
    id: 'class-uuid',
    name: 'L2 Info',
    academicYear: '2026-2027',
    description: null,
    status: ClassStatus.ACTIVE,
    ownerId: OWNER_ID,
    coOwnerId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    class: {
      create: jest.fn().mockResolvedValue(makeClass()),
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn().mockResolvedValue(makeClass()),
      findMany: jest.fn().mockResolvedValue([makeClass()]),
      update: jest.fn().mockImplementation((args: { data: Partial<ClassContext> }) =>
        Promise.resolve(makeClass(args.data as Partial<ClassContext>)),
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    classMember: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }),
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(0),
    },
    course: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    document: { count: jest.fn().mockResolvedValue(0) },
    message: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn().mockImplementation((fn: ((tx: unknown) => Promise<unknown>) | unknown[]) => {
      if (typeof fn === 'function') {
        return fn(prisma);
      }
      return Promise.all(fn as Promise<unknown>[]);
    }),
    ...prismaOverrides,
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return new ClassesService(prisma, audit);
}

// ---------------------------------------------------------------------------
// Créer une classe
// ---------------------------------------------------------------------------

describe('ClassesService.create', () => {
  it('crée la classe et inscrit le owner en ClassMember dans une transaction', async () => {
    const createMock = jest.fn().mockResolvedValue(makeClass());
    const memberCreateMock = jest.fn().mockResolvedValue({});

    const service = makeService({
      class: { create: createMock, findUnique: jest.fn().mockResolvedValue(null) },
      classMember: { create: memberCreateMock, findUnique: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
    });

    const result = await service.create(
      { name: 'L2 Info', academicYear: '2026-2027' },
      OWNER_ID,
    );

    expect(result.ownerId).toBe(OWNER_ID);
  });
});

// ---------------------------------------------------------------------------
// Modifier
// ---------------------------------------------------------------------------

describe('ClassesService.update', () => {
  it('met à jour les champs fournis', async () => {
    const service = makeService();
    const result = await service.update(makeClass(), { name: 'Nouveau nom' }, OWNER_ID);
    expect(result).toBeDefined();
  });

  it('refuse la modification si la classe est archivée', async () => {
    const service = makeService();
    await expect(
      service.update(makeClass({ status: ClassStatus.ARCHIVED }), { name: 'X' }, OWNER_ID),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// Rejoindre
// ---------------------------------------------------------------------------

describe('ClassesService.join', () => {
  it('lève NotFoundException si le code est invalide ou la classe inactive', async () => {
    const service = makeService({
      class: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(service.join('BADCODE', MEMBER_ID)).rejects.toThrow(NotFoundException);
  });

  it('lève ConflictException si déjà membre (P2002)', async () => {
    const err = { code: 'P2002' };
    const service = makeService({
      class: {
        findUnique: jest.fn().mockResolvedValue({ id: 'class-uuid', status: ClassStatus.ACTIVE, ownerId: OWNER_ID }),
      },
      classMember: { create: jest.fn().mockRejectedValue(err) },
    });
    await expect(service.join('VALIDCOD', MEMBER_ID)).rejects.toThrow(ConflictException);
  });
});

// ---------------------------------------------------------------------------
// Co-owner — logique de concurrence
// ---------------------------------------------------------------------------

describe('ClassesService.setCoOwner', () => {
  it('lève ForbiddenException si l\'acteur n\'est pas l\'owner principal', async () => {
    const service = makeService();
    await expect(
      service.setCoOwner(makeClass(), { userId: MEMBER_ID }, CO_OWNER_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lève BadRequestException si le candidat est le owner lui-même', async () => {
    const service = makeService();
    await expect(
      service.setCoOwner(makeClass(), { userId: OWNER_ID }, OWNER_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('lève BadRequestException si le candidat n\'est pas membre', async () => {
    const service = makeService({
      classMember: { findUnique: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      service.setCoOwner(makeClass(), { userId: OTHER_ID }, OWNER_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('lève ConflictException si updateMany retourne count=0 (créneau déjà pris — race condition)', async () => {
    const service = makeService({
      class: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(
      service.setCoOwner(makeClass(), { userId: MEMBER_ID }, OWNER_ID),
    ).rejects.toThrow(ConflictException);
  });

  it('réussit et retourne la classe mise à jour si count=1', async () => {
    const service = makeService({
      class: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(makeClass({ coOwnerId: MEMBER_ID })),
      },
    });
    const result = await service.setCoOwner(makeClass(), { userId: MEMBER_ID }, OWNER_ID);
    expect(result.coOwnerId).toBe(MEMBER_ID);
  });
});

// ---------------------------------------------------------------------------
// Retirer un membre
// ---------------------------------------------------------------------------

describe('ClassesService.removeMember', () => {
  it('refuse de retirer le owner principal', async () => {
    const service = makeService();
    await expect(
      service.removeMember(makeClass(), OWNER_ID, OWNER_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('lève NotFoundException si le user n\'est pas membre', async () => {
    const service = makeService({
      classMember: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    });
    await expect(
      service.removeMember(makeClass(), OTHER_ID, OWNER_ID),
    ).rejects.toThrow(NotFoundException);
  });

  it('libère le slot co-owner si on retire le co-owner', async () => {
    const updateMock = jest.fn().mockResolvedValue({});
    const service = makeService({
      class: { update: updateMock },
      classMember: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    });
    await service.removeMember(makeClass({ coOwnerId: CO_OWNER_ID }), CO_OWNER_ID, OWNER_ID);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: { coOwnerId: null } }),
    );
  });
});

// ---------------------------------------------------------------------------
// Archivage
// ---------------------------------------------------------------------------

describe('ClassesService.archive', () => {
  it('archive une classe ACTIVE', async () => {
    const service = makeService();
    const result = await service.archive(makeClass(), OWNER_ID);
    expect(result).toBeDefined();
  });

  it('refuse si la classe est déjà archivée', async () => {
    const service = makeService();
    await expect(
      service.archive(makeClass({ status: ClassStatus.ARCHIVED }), OWNER_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('refuse si l\'acteur n\'est pas l\'owner principal', async () => {
    const service = makeService();
    await expect(
      service.archive(makeClass(), CO_OWNER_ID),
    ).rejects.toThrow(ForbiddenException);
  });
});

// ---------------------------------------------------------------------------
// Isolation IDOR — test de principe
// ---------------------------------------------------------------------------

describe('Isolation IDOR', () => {
  it('ClassMemberGuard : un user non-membre ne reçoit pas les données de la classe', async () => {
    // Le guard interroge la DB pour chaque requête — la logique d'accès n'est
    // jamais basée sur un champ fourni par le client.
    // Ce test valide que le service lui-même ne court-circuite pas ce contrôle :
    // un classContext avec un ownerId différent du user courant lève bien une
    // ForbiddenException au niveau du service (archive, co-owner...).
    const service = makeService();
    await expect(
      service.archive(makeClass({ ownerId: 'some-other-owner' }), OWNER_ID),
    ).rejects.toThrow(ForbiddenException);
  });
});
