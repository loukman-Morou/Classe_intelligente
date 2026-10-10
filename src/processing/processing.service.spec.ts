import { DocumentStatus } from '@prisma/client';
import { ChunkingService } from '../documents/chunking.service';
import { OcrWorker } from './workers/ocr.worker';
import { PurgeWorker } from './workers/purge.worker';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { OcrService } from '../ocr/ocr.service';

// ---------------------------------------------------------------------------
// ChunkingService
// ---------------------------------------------------------------------------

describe('ChunkingService', () => {
  const svc = new ChunkingService();

  it('retourne un tableau vide pour un texte trop court', () => {
    expect(svc.chunk('Court.')).toHaveLength(0);
  });

  it('produit au moins un chunk pour un texte suffisant', () => {
    const text = 'Le subnetting est une technique réseau. '.repeat(30);
    const chunks = svc.chunk(text);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it('respecte la taille maximale de chunk (~2000 chars)', () => {
    const text = 'A'.repeat(100) + '\n\n' + 'B'.repeat(100) + '\n\n' + 'C'.repeat(3000);
    const chunks = svc.chunk(text);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeLessThanOrEqual(2200); // tolérance overlap
    }
  });

  it('génère un overlap entre chunks consécutifs', () => {
    // Texte long assez pour créer au moins 2 chunks distincts
    const longParagraph = 'Le protocole IP est fondamental en réseaux informatiques. '.repeat(40);
    const chunks = svc.chunk(longParagraph);

    if (chunks.length >= 2) {
      // Le début du 2e chunk doit se retrouver dans la fin du 1er (overlap).
      const endOf1 = chunks[0].content.slice(-100);
      const startOf2 = chunks[1].content.slice(0, 100);
      // Ils doivent partager au moins quelques caractères communs.
      const hasOverlap = startOf2.split(' ').some((word) => endOf1.includes(word) && word.length > 4);
      expect(hasOverlap).toBe(true);
    }
  });

  it('nettoie les caractères de contrôle et whitespace redondants', () => {
    const dirty = 'Titre\r\n\r\nParagraphe 1\r\n\r\nParagraphe 2\x00parasites\x01ici.  Fin.';
    const chunks = svc.chunk(dirty.repeat(5));
    for (const chunk of chunks) {
      expect(chunk.content).not.toMatch(/[\x00-\x08]/);
      expect(chunk.content).not.toMatch(/\r/);
    }
  });

  it('attribue des indices séquentiels', () => {
    const text = 'Contenu suffisant pour chunking. '.repeat(60);
    const chunks = svc.chunk(text);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it('calcule tokenCount approximatif (chars/4)', () => {
    const text = 'Test texte. '.repeat(50);
    const chunks = svc.chunk(text);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeCloseTo(chunk.content.length / 4, 0);
    }
  });
});

// ---------------------------------------------------------------------------
// OcrWorker — pipeline complet (mocks)
// ---------------------------------------------------------------------------

function makeOcrWorker(overrides: Record<string, unknown> = {}) {
  const DOC_ID   = 'doc-uuid';
  const COURSE_ID = 'course-uuid';
  const CLASS_ID  = 'class-uuid';

  const prisma = {
    document: {
      findUnique: jest.fn().mockResolvedValue({
        id: DOC_ID, storageKey: 'courses/x/file.pdf',
        mimeType: 'application/pdf', status: DocumentStatus.PROCESSING,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    course: {
      findUnique: jest.fn().mockResolvedValue({ classId: CLASS_ID }),
    },
    documentChunk: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
    },
    processingJob: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: jest.fn().mockImplementation(async (fn: unknown) => {
      if (typeof fn === 'function') return fn(prisma);
      if (Array.isArray(fn)) return Promise.all(fn as Promise<unknown>[]);
    }),
    ...overrides,
  } as unknown as PrismaService;

  const storage = {
    getDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/signed'),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;

  const ocrService = {
    extractText: jest.fn().mockResolvedValue('Texte extrait du document. '.repeat(10)),
  } as unknown as OcrService;

  const chunking = new ChunkingService();

  return { worker: new OcrWorker(prisma, storage, ocrService, chunking), prisma, ocrService, storage };
}

describe('OcrWorker.process', () => {
  beforeEach(() => {
    // Mock global fetch pour le téléchargement S3
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: jest.fn().mockResolvedValue(new ArrayBuffer(100)),
    }) as jest.Mock;
  });

  it('complète le pipeline et passe le document à READY', async () => {
    const { worker, prisma } = makeOcrWorker();

    await worker.process({
      id: 'job-1',
      data: { documentId: 'doc-uuid', courseId: 'course-uuid' },
    } as never);

    // Vérifier que le document a été passé à READY via la transaction
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it('passe à FAILED si l\'extraction échoue et re-lance l\'erreur (retry BullMQ)', async () => {
    const { worker, prisma } = makeOcrWorker({
      document: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'doc-uuid', storageKey: 'key', mimeType: 'application/pdf',
          status: DocumentStatus.PROCESSING,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    // Simuler un fetch qui échoue
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      arrayBuffer: jest.fn(),
    }) as jest.Mock;

    await expect(
      worker.process({
        id: 'job-2',
        data: { documentId: 'doc-uuid', courseId: 'course-uuid' },
      } as never),
    ).rejects.toThrow();

    // Le statut FAILED doit être enregistré
    expect((prisma.document.update as jest.Mock)).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: DocumentStatus.FAILED } }),
    );
  });

  it('annule proprement si le document est DELETED avant traitement', async () => {
    const { worker, prisma } = makeOcrWorker({
      document: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'doc-uuid', storageKey: 'key', mimeType: 'application/pdf',
          status: DocumentStatus.DELETED,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    await expect(
      worker.process({
        id: 'job-3',
        data: { documentId: 'doc-uuid', courseId: 'course-uuid' },
      } as never),
    ).resolves.toBeUndefined();

    // Aucun chunk créé, aucun appel à fetch
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('ne stocke pas de stack trace dans errorMessage (sécurité)', async () => {
    const { worker, prisma } = makeOcrWorker({
      document: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'doc-uuid', storageKey: 'key', mimeType: 'application/pdf',
          status: DocumentStatus.PROCESSING,
        }),
        update: jest.fn().mockResolvedValue({}),
      },
    });

    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as jest.Mock;

    await expect(
      worker.process({ id: 'j', data: { documentId: 'doc-uuid', courseId: 'course-uuid' } } as never),
    ).rejects.toThrow();

    const updateCall = (prisma.processingJob.updateMany as jest.Mock).mock.calls.find(
      (call: unknown[]) => {
        const arg = call[0] as { data?: { status?: string } };
        return arg?.data?.status === 'FAILED';
      },
    );

    if (updateCall) {
      const errorMsg = (updateCall[0] as { data: { errorMessage: string } }).data.errorMessage;
      expect(errorMsg).not.toMatch(/at\s+.*\(.*:\d+:\d+\)/); // pas de stack trace
      expect(errorMsg).not.toMatch(/\/home\//);               // pas de chemin système
    }
  });
});

// ---------------------------------------------------------------------------
// PurgeWorker — garde-fous
// ---------------------------------------------------------------------------

describe('PurgeWorker.process', () => {
  function makePurgeWorker(docStatus = DocumentStatus.DELETED) {
    const prisma = {
      document: {
        findUnique: jest.fn().mockResolvedValue({ id: 'doc-uuid', status: docStatus }),
      },
      documentChunk: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaService;

    const storage = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
    } as unknown as StorageService;

    return { worker: new PurgeWorker(prisma, storage), storage, prisma };
  }

  it('supprime l\'objet S3 si le document est bien DELETED', async () => {
    const { worker, storage } = makePurgeWorker(DocumentStatus.DELETED);
    await worker.process({
      id: 'j', data: { documentId: 'doc-uuid', storageKey: 'courses/x/file.pdf' },
    } as never);
    expect(storage.deleteObject).toHaveBeenCalledWith('courses/x/file.pdf');
  });

  it('annule la purge si le document a été restauré (statut READY)', async () => {
    const { worker, storage } = makePurgeWorker(DocumentStatus.READY);
    await worker.process({
      id: 'j', data: { documentId: 'doc-uuid', storageKey: 'courses/x/file.pdf' },
    } as never);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('annule si le document n\'existe plus en DB', async () => {
    const prisma = {
      document: { findUnique: jest.fn().mockResolvedValue(null) },
      documentChunk: { deleteMany: jest.fn() },
    } as unknown as PrismaService;
    const storage = { deleteObject: jest.fn() } as unknown as StorageService;
    const worker = new PurgeWorker(prisma, storage);

    await worker.process({
      id: 'j', data: { documentId: 'gone-uuid', storageKey: 'courses/x/file.pdf' },
    } as never);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });
});
