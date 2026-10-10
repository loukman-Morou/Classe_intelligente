/**
 * Tests de concurrence — Phase 14
 *
 * Vérifie les protections contre les race conditions sur les opérations
 * critiques (co-owner, quota upload, etc.).
 *
 * Ces tests simulent deux requêtes concurrentes via des mocks — la vraie
 * protection est dans la couche DB (voir docs/database.md §Concurrence).
 */

import { ConflictException } from '@nestjs/common';
import { ClassStatus } from '@prisma/client';
import { ClassesService } from '../../src/classes/classes.service';
import { PrismaService } from '../../src/prisma/prisma.service';
import { AuditService } from '../../src/audit/audit.service';
import { ClassContext } from '../../src/classes/classes.types';

const OWNER_ID    = 'owner-uuid';
const MEMBER_A_ID = 'member-a-uuid';
const MEMBER_B_ID = 'member-b-uuid';
const CLASS_ID    = 'class-uuid';

function makeClassCtx(): ClassContext {
  return {
    id: CLASS_ID, name: 'L2 Info', academicYear: '2026-2027',
    description: null, status: ClassStatus.ACTIVE,
    ownerId: OWNER_ID, coOwnerId: null,
    createdAt: new Date(), updatedAt: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Race condition — attribution co-owner
// ---------------------------------------------------------------------------

describe('Concurrence : attribution co-owner', () => {
  /**
   * Scénario : deux requêtes simultanées tentent de remplir le créneau
   * co-owner d'une classe dont coOwnerId est NULL.
   *
   * Protection : UPDATE ... WHERE coOwnerId IS NULL (atomique)
   *   → la première réussit (count=1)
   *   → la deuxième échoue (count=0, le créneau est déjà pris)
   *
   * Ce test vérifie que le service détecte correctement count=0 et lève
   * ConflictException au lieu de créer un état incohérent.
   */
  it('la deuxième tentative concurrente lève ConflictException (updateMany count=0)', async () => {
    // Simuler que le `updateMany` retourne count=0 (le créneau était déjà pris
    // par la première requête, arrivée quelques ms avant).
    const prisma = {
      class: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }), // créneau déjà pris
        findUniqueOrThrow: jest.fn().mockResolvedValue(makeClassCtx()),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      classMember: { findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }) },
    } as unknown as PrismaService;

    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const svc   = new ClassesService(prisma, audit);

    await expect(
      svc.setCoOwner(makeClassCtx(), { userId: MEMBER_B_ID }, OWNER_ID),
    ).rejects.toThrow(ConflictException);
  });

  it('la première tentative concurrente réussit (updateMany count=1)', async () => {
    const prisma = {
      class: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }), // créneau disponible
        findUniqueOrThrow: jest.fn().mockResolvedValue(
          makeClassCtx({ coOwnerId: MEMBER_A_ID } as Partial<ClassContext> & { coOwnerId: string }),
        ),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      classMember: { findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }) },
    } as unknown as PrismaService;

    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const svc   = new ClassesService(prisma, audit);

    const result = await svc.setCoOwner(makeClassCtx(), { userId: MEMBER_A_ID }, OWNER_ID);
    expect(result.coOwnerId).toBe(MEMBER_A_ID);
  });

  it('simule deux requêtes simultanées : exactement 1 réussit, 1 échoue', async () => {
    /**
     * Simulation de vraie concurrence :
     * - Premier appel → updateMany retourne count=1
     * - Deuxième appel (arrive 1ms après, créneau déjà pris) → count=0
     *
     * updateMany est notre source de vérité atomique (une seule mise à jour
     * peut modifier une ligne WHERE coOwnerId IS NULL pour un classId donné).
     */
    let callCount = 0;
    const prisma = {
      class: {
        updateMany: jest.fn().mockImplementation(() => {
          callCount++;
          // Premier appel : réussite. Deuxième : créneau déjà pris.
          return Promise.resolve({ count: callCount === 1 ? 1 : 0 });
        }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(makeClassCtx()),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      classMember: { findUnique: jest.fn().mockResolvedValue({ id: 'cm-1' }) },
    } as unknown as PrismaService;

    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const svc   = new ClassesService(prisma, audit);

    const [result1, result2] = await Promise.allSettled([
      svc.setCoOwner(makeClassCtx(), { userId: MEMBER_A_ID }, OWNER_ID),
      svc.setCoOwner(makeClassCtx(), { userId: MEMBER_B_ID }, OWNER_ID),
    ]);

    // Exactement une réussite, exactement un échec.
    const statuses = [result1.status, result2.status].sort();
    expect(statuses).toEqual(['fulfilled', 'rejected']);

    if (result2.status === 'rejected') {
      expect(result2.reason).toBeInstanceOf(ConflictException);
    }
  });
});

// ---------------------------------------------------------------------------
// Idempotence — retrait co-owner
// ---------------------------------------------------------------------------

describe('Idempotence : retrait co-owner', () => {
  it('retirer un co-owner déjà null ne lève pas d\'erreur', async () => {
    const prisma = {
      class: {
        update: jest.fn().mockResolvedValue(makeClassCtx()),
        findUniqueOrThrow: jest.fn().mockResolvedValue(makeClassCtx()),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
    } as unknown as PrismaService;

    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const svc   = new ClassesService(prisma, audit);

    // Classe sans co-owner : retirer le co-owner est une opération idempotente.
    await expect(
      svc.removeCoOwner(makeClassCtx({ coOwnerId: null }), OWNER_ID),
    ).resolves.toBeDefined();
  });
});
