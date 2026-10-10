import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { DocumentStatus, ProfessorDocumentType } from '@prisma/client';
import { FileValidationService } from './file-validation.service';
import { DocumentsService } from './documents.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { ProcessingProducerService } from '../processing/processing-producer.service';
import { ConfigService } from '@nestjs/config';

// ---------------------------------------------------------------------------
// FileValidationService
// ---------------------------------------------------------------------------

describe('FileValidationService', () => {
  const svc = new FileValidationService();

  describe('assertMimeAllowed', () => {
    it('accepte application/pdf', () => {
      expect(() => svc.assertMimeAllowed('application/pdf')).not.toThrow();
    });

    it('accepte image/jpeg et image/png', () => {
      expect(() => svc.assertMimeAllowed('image/jpeg')).not.toThrow();
      expect(() => svc.assertMimeAllowed('image/png')).not.toThrow();
    });

    it('rejette text/html', () => {
      expect(() => svc.assertMimeAllowed('text/html')).toThrow(BadRequestException);
    });

    it('rejette application/x-executable', () => {
      expect(() => svc.assertMimeAllowed('application/x-executable')).toThrow(BadRequestException);
    });
  });

  describe('assertMagicBytes', () => {
    it('valide les magic bytes PDF (%PDF)', () => {
      const header = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      expect(() => svc.assertMagicBytes('application/pdf', header)).not.toThrow();
    });

    it('valide les magic bytes PNG', () => {
      const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(() => svc.assertMagicBytes('image/png', header)).not.toThrow();
    });

    it('valide les magic bytes JPEG', () => {
      const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
      expect(() => svc.assertMagicBytes('image/jpeg', header)).not.toThrow();
    });

    it('rejette un exécutable masqué en PDF', () => {
      // ELF header (Linux executable) déclaré comme PDF.
      const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
      expect(() => svc.assertMagicBytes('application/pdf', elfHeader))
        .toThrow(BadRequestException);
    });

    it('rejette un PNG déclaré comme JPEG', () => {
      const pngHeader = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      expect(() => svc.assertMagicBytes('image/jpeg', pngHeader))
        .toThrow(BadRequestException);
    });
  });
});

// ---------------------------------------------------------------------------
// DocumentsService
// ---------------------------------------------------------------------------

const ACTOR_ID  = 'actor-uuid';
const COURSE_ID = 'course-uuid';
const DOC_ID    = 'doc-uuid';
const EXAM_ID   = 'exam-uuid';

function makeDoc(overrides: object = {}) {
  return {
    id: DOC_ID, courseId: COURSE_ID, status: DocumentStatus.UPLOADED,
    mimeType: 'application/pdf', uploadedByUserId: ACTOR_ID,
    storageKey: 'courses/x/file.pdf',
    documentType: ProfessorDocumentType.COURSE_MATERIAL,
    ...overrides,
  };
}

function makeService(prismaOverrides: Record<string, unknown> = {}) {
  const prisma = {
    document: {
      create: jest.fn().mockResolvedValue(makeDoc()),
      findUnique: jest.fn().mockResolvedValue(makeDoc()),
      findMany: jest.fn().mockResolvedValue([makeDoc()]),
      update: jest.fn().mockResolvedValue(makeDoc()),
      aggregate: jest.fn().mockResolvedValue({ _sum: { sizeBytes: 0 } }),
    },
    processingJob: { create: jest.fn().mockResolvedValue({}) },
    ...prismaOverrides,
  } as unknown as PrismaService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const storage = {
    getUploadUrl: jest.fn().mockResolvedValue('https://s3.example.com/presigned-upload'),
    getDownloadUrl: jest.fn().mockResolvedValue('https://s3.example.com/presigned-download'),
    deleteObject: jest.fn().mockResolvedValue(undefined),
  } as unknown as StorageService;

  const processingProducer = {
    enqueueOcr: jest.fn().mockResolvedValue(undefined),
    enqueuePurge: jest.fn().mockResolvedValue(undefined),
  } as unknown as ProcessingProducerService;

  const config = {
    get: jest.fn().mockReturnValue({
      maxFileSizeBytes: 50 * 1024 * 1024,
      maxQuotaPerCourseBytes: 500 * 1024 * 1024,
      signedUrlTtlSeconds: 900,
    }),
  } as unknown as ConfigService;

  const fileValidation = new FileValidationService();

  return new DocumentsService(prisma, audit, storage, fileValidation, processingProducer, config);
}

// ---------------------------------------------------------------------------
// requestUploadUrl
// ---------------------------------------------------------------------------

describe('DocumentsService.requestUploadUrl', () => {
  it('retourne un documentId + uploadUrl', async () => {
    const svc = makeService();
    const result = await svc.requestUploadUrl(
      COURSE_ID,
      { fileName: 'cours.pdf', contentType: 'application/pdf', size: 1024 },
      ACTOR_ID,
    );
    expect(result).toHaveProperty('documentId');
    expect(result).toHaveProperty('uploadUrl');
    expect(result.uploadUrl).toContain('presigned-upload');
  });

  it('rejette un MIME non autorisé', async () => {
    const svc = makeService();
    await expect(
      svc.requestUploadUrl(
        COURSE_ID,
        { fileName: 'malware.exe', contentType: 'application/x-msdownload', size: 512 },
        ACTOR_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejette un fichier dépassant la taille maximale', async () => {
    const svc = makeService();
    await expect(
      svc.requestUploadUrl(
        COURSE_ID,
        { fileName: 'big.pdf', contentType: 'application/pdf', size: 100 * 1024 * 1024 },
        ACTOR_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejette si le quota du cours est dépassé', async () => {
    const svc = makeService({
      document: {
        create: jest.fn(),
        aggregate: jest.fn().mockResolvedValue({
          _sum: { sizeBytes: 499 * 1024 * 1024 }, // 499 Mo déjà utilisés
        }),
      },
    });
    await expect(
      svc.requestUploadUrl(
        COURSE_ID,
        { fileName: 'cours.pdf', contentType: 'application/pdf', size: 5 * 1024 * 1024 },
        ACTOR_ID,
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// completeUpload
// ---------------------------------------------------------------------------

describe('DocumentsService.completeUpload', () => {
  // Magic bytes PDF valides (%PDF)
  const validPdfHeader = Buffer.from([0x25, 0x50, 0x44, 0x46]).toString('base64');
  // Magic bytes ELF (exécutable Linux)
  const elfHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46]).toString('base64');

  it('passe en PROCESSING et enfile le job OCR si magic bytes valides', async () => {
    const enqueueMock = jest.fn().mockResolvedValue(undefined);
    const svc = makeService({
      document: {
        findUnique: jest.fn().mockResolvedValue(makeDoc()),
        update: jest.fn().mockResolvedValue(makeDoc({ status: DocumentStatus.PROCESSING })),
        aggregate: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
      processingJob: { create: jest.fn().mockResolvedValue({}) },
    });
    // Injecter un mock pour enqueueOcr
    (svc as unknown as { processingProducer: { enqueueOcr: jest.Mock } })
      .processingProducer.enqueueOcr = enqueueMock;

    await svc.completeUpload(DOC_ID, { headerBytesBase64: validPdfHeader }, ACTOR_ID);
    expect(enqueueMock).toHaveBeenCalledWith(DOC_ID, COURSE_ID);
  });

  it('rejette si les magic bytes ne correspondent pas au MIME déclaré', async () => {
    const svc = makeService();
    await expect(
      svc.completeUpload(DOC_ID, { headerBytesBase64: elfHeader }, ACTOR_ID),
    ).rejects.toThrow(BadRequestException);
  });

  it('lève ForbiddenException si l\'acteur n\'est pas l\'initiateur de l\'upload', async () => {
    const svc = makeService({
      document: {
        findUnique: jest.fn().mockResolvedValue(makeDoc({ uploadedByUserId: 'someone-else' })),
        update: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
    });
    await expect(
      svc.completeUpload(DOC_ID, { headerBytesBase64: validPdfHeader }, ACTOR_ID),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lève BadRequestException si le document n\'est pas en statut UPLOADED', async () => {
    const svc = makeService({
      document: {
        findUnique: jest.fn().mockResolvedValue(makeDoc({ status: DocumentStatus.READY })),
        update: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
    });
    await expect(
      svc.completeUpload(DOC_ID, { headerBytesBase64: validPdfHeader }, ACTOR_ID),
    ).rejects.toThrow(BadRequestException);
  });
});

// ---------------------------------------------------------------------------
// getDownloadUrl — corrigé non visible avant date
// ---------------------------------------------------------------------------

describe('DocumentsService.getDownloadUrl', () => {
  it('retourne une URL de téléchargement signée pour un document READY', async () => {
    const svc = makeService({
      document: {
        findUnique: jest.fn().mockResolvedValue(
          makeDoc({ status: DocumentStatus.READY, storageKey: 'courses/x/file.pdf' }),
        ),
        update: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
    });
    const result = await svc.getDownloadUrl(DOC_ID, ACTOR_ID);
    expect(result.downloadUrl).toContain('presigned-download');
  });

  it('bloque l\'accès à un corrigé avant sa date de visibilité', async () => {
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // dans 7 jours
    const svc = makeService({
      document: {
        findUnique: jest.fn().mockResolvedValue(
          makeDoc({
            status: DocumentStatus.READY,
            documentType: ProfessorDocumentType.CORRECTION,
            correctionVisibleAt: future,
          }),
        ),
        update: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
    });
    await expect(svc.getDownloadUrl(DOC_ID, ACTOR_ID)).rejects.toThrow(ForbiddenException);
  });

  it('autorise l\'accès à un corrigé dont la date est passée', async () => {
    const past = new Date(Date.now() - 1000);
    const svc = makeService({
      document: {
        findUnique: jest.fn().mockResolvedValue(
          makeDoc({
            status: DocumentStatus.READY,
            documentType: ProfessorDocumentType.CORRECTION,
            correctionVisibleAt: past,
          }),
        ),
        update: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
    });
    const result = await svc.getDownloadUrl(DOC_ID, ACTOR_ID);
    expect(result.downloadUrl).toContain('presigned-download');
  });

  it('lève NotFoundException pour un document supprimé', async () => {
    const svc = makeService({
      document: {
        findUnique: jest.fn().mockResolvedValue(
          makeDoc({ status: DocumentStatus.DELETED }),
        ),
        update: jest.fn(),
        aggregate: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
      },
    });
    await expect(svc.getDownloadUrl(DOC_ID, ACTOR_ID)).rejects.toThrow(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// Sécurité — storageKey jamais exposé
// ---------------------------------------------------------------------------

describe('Sécurité — storageKey non exposé', () => {
  it('findAllForCourse ne retourne pas storageKey dans sa sélection', async () => {
    const svc = makeService();
    const results = await svc.findAllForCourse(COURSE_ID);
    for (const doc of results) {
      expect(doc).not.toHaveProperty('storageKey');
    }
  });
});
