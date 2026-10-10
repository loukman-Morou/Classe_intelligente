import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DocumentStatus, ProfessorDocumentType } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { FileValidationService } from './file-validation.service';
import { LifecycleService } from '../lifecycle/lifecycle.service';
import { ProcessingProducerService } from '../processing/processing-producer.service';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { ConfigService } from '@nestjs/config';
import { StorageConfig } from '../config/configuration';

@Injectable()
export class DocumentsService {
  private readonly maxFileSizeBytes: number;
  private readonly maxQuotaPerCourseBytes: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly fileValidation: FileValidationService,
    private readonly processingProducer: ProcessingProducerService,
    private readonly config: ConfigService,
    private readonly lifecycle: LifecycleService,
  ) {
    const storageCfg = this.config.get<StorageConfig>('storage')!;
    this.maxFileSizeBytes = storageCfg.maxFileSizeBytes;
    this.maxQuotaPerCourseBytes = storageCfg.maxQuotaPerCourseBytes;
  }

  // --------------------------------------------------------------------------
  // 1. Demander une URL d'upload présignée
  // --------------------------------------------------------------------------

  async requestUploadUrl(
    courseId: string,
    dto: RequestUploadUrlDto,
    actorId: string,
  ) {
    // Valider le MIME déclaré (magic bytes vérifiés à l'étape complete).
    this.fileValidation.assertMimeAllowed(dto.contentType);

    // Valider la taille déclarée.
    if (dto.size > this.maxFileSizeBytes) {
      throw new BadRequestException(
        `Fichier trop volumineux. Maximum : ${Math.round(this.maxFileSizeBytes / 1024 / 1024)} Mo.`,
      );
    }

    // Vérifier le quota du cours.
    await this.assertQuotaNotExceeded(courseId, dto.size);

    // Le storageKey est généré côté serveur — jamais depuis le nom original
    // (protection path traversal, voir docs/security.md §10).
    const ext = this.mimeToExtension(dto.contentType);
    const storageKey = `courses/${courseId}/${randomUUID()}${ext}`;

    // Obtenir l'URL d'upload S3 présignée.
    const uploadUrl = await this.storage.getUploadUrl(storageKey, dto.contentType, dto.size);

    // Créer le document en statut UPLOADED (pas encore READY — l'upload
    // client peut échouer, et l'OCR n'a pas encore tourné).
    const document = await this.prisma.document.create({
      data: {
        courseId,
        uploadedByUserId: actorId,
        originalFilename: dto.fileName,
        storageKey,
        mimeType: dto.contentType,
        sizeBytes: dto.size,
        status: DocumentStatus.UPLOADED,
        documentType: dto.documentType ?? ProfessorDocumentType.COURSE_MATERIAL,
      },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'DOCUMENT_UPLOAD_REQUESTED',
      targetType: 'Document',
      targetId: document.id,
      metadata: { courseId, mimeType: dto.contentType, sizeBytes: dto.size },
    });

    return {
      documentId: document.id,
      uploadUrl,
      expiresAt: new Date(Date.now() + 300_000), // 5 minutes
    };
  }

  // --------------------------------------------------------------------------
  // 2. Finaliser l'upload (magic bytes + enqueue OCR)
  // --------------------------------------------------------------------------

  async completeUpload(
    documentId: string,
    dto: CompleteUploadDto,
    actorId: string,
  ) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true, courseId: true, status: true, mimeType: true,
        uploadedByUserId: true, storageKey: true,
        documentType: true,
      },
    });

    if (!document) throw new NotFoundException('Document introuvable.');
    if (document.status !== DocumentStatus.UPLOADED) {
      throw new BadRequestException('Ce document ne peut pas être finalisé dans son état actuel.');
    }

    // Vérifier que l'acteur est bien celui qui a initié l'upload.
    if (document.uploadedByUserId !== actorId) {
      throw new ForbiddenException("Vous n'avez pas initié cet upload.");
    }

    // Vérification des magic bytes — défense critique contre les fichiers forgés.
    const headerBytes = Buffer.from(dto.headerBytesBase64, 'base64');
    this.fileValidation.assertMagicBytes(document.mimeType, headerBytes);

    // Gérer les métadonnées de corrigé si applicable.
    const correctionData = await this.resolveCorrectionData(document.id, dto);

    // Passer en PROCESSING + sauvegarder les métadonnées finales.
    const updated = await this.prisma.document.update({
      where: { id: documentId },
      data: {
        status: DocumentStatus.PROCESSING,
        documentType: dto.documentType ?? document.documentType,
        ...correctionData,
      },
    });

    // Enqueue le job OCR/traitement asynchrone.
    await this.processingProducer.enqueueOcr(document.id, document.courseId);

    // Mise à jour lastActivityAt — fire-and-forget (Phase 13).
    void this.lifecycle.touchClass(document.courseId).catch(() => undefined);

    await this.audit.record({
      actorUserId: actorId,
      action: 'DOCUMENT_UPLOAD_COMPLETED',
      targetType: 'Document',
      targetId: document.id,
    });

    return updated;
  }

  // --------------------------------------------------------------------------
  // 3. Lister les documents d'un cours
  // --------------------------------------------------------------------------

  async findAllForCourse(courseId: string) {
    return this.prisma.document.findMany({
      where: { courseId, status: { not: DocumentStatus.DELETED } },
      select: {
        id: true, originalFilename: true, mimeType: true, sizeBytes: true,
        status: true, documentType: true, correctionVisibleAt: true,
        createdAt: true, updatedAt: true,
        // Ne jamais exposer storageKey au client — URL générée à la demande.
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // --------------------------------------------------------------------------
  // 4. Obtenir une URL de téléchargement signée
  // --------------------------------------------------------------------------

  async getDownloadUrl(documentId: string, actorId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        id: true, status: true, storageKey: true, originalFilename: true,
        documentType: true, correctionVisibleAt: true, mimeType: true,
      },
    });

    if (!document || document.status === DocumentStatus.DELETED) {
      throw new NotFoundException('Document introuvable.');
    }

    if (document.status !== DocumentStatus.READY) {
      throw new BadRequestException('Ce document n\'est pas encore disponible.');
    }

    // Blocage corrigé non encore visible.
    if (
      document.documentType === ProfessorDocumentType.CORRECTION &&
      document.correctionVisibleAt &&
      document.correctionVisibleAt > new Date()
    ) {
      throw new ForbiddenException(
        `Ce corrigé sera accessible à partir du ${document.correctionVisibleAt.toLocaleDateString('fr-FR')}.`,
      );
    }

    const downloadUrl = await this.storage.getDownloadUrl(document.storageKey);

    await this.audit.record({
      actorUserId: actorId,
      action: 'DOCUMENT_DOWNLOADED',
      targetType: 'Document',
      targetId: documentId,
    });

    return { downloadUrl, expiresIn: 900 };
  }

  // --------------------------------------------------------------------------
  // 5. Suppression logique immédiate (purge physique asynchrone Phase 7)
  // --------------------------------------------------------------------------

  async remove(documentId: string, actorId: string) {
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, status: true, courseId: true, storageKey: true },
    });

    if (!document || document.status === DocumentStatus.DELETED) {
      throw new NotFoundException('Document introuvable.');
    }

    // Suppression logique immédiate : l'accès est coupé instantanément.
    // La suppression physique S3 est gérée par un job asynchrone (Phase 7).
    await this.prisma.document.update({
      where: { id: documentId },
      data: { status: DocumentStatus.DELETED, deletedAt: new Date() },
    });

    await this.audit.record({
      actorUserId: actorId,
      action: 'DOCUMENT_DELETED',
      targetType: 'Document',
      targetId: documentId,
      metadata: { courseId: document.courseId, storageKey: document.storageKey },
    });
  }

  // --------------------------------------------------------------------------
  // Helpers privés
  // --------------------------------------------------------------------------

  private async assertQuotaNotExceeded(courseId: string, newFileSizeBytes: number) {
    const result = await this.prisma.document.aggregate({
      where: { courseId, status: { not: DocumentStatus.DELETED } },
      _sum: { sizeBytes: true },
    });

    const used = result._sum.sizeBytes ?? 0;
    if (used + newFileSizeBytes > this.maxQuotaPerCourseBytes) {
      const maxMo = Math.round(this.maxQuotaPerCourseBytes / 1024 / 1024);
      throw new BadRequestException(
        `Quota de stockage dépassé pour ce cours (maximum : ${maxMo} Mo).`,
      );
    }
  }

  private async resolveCorrectionData(
    documentId: string,
    dto: CompleteUploadDto,
  ): Promise<{ correctionDocumentId?: string; correctionVisibleAt?: Date | null }> {
    if (
      dto.documentType === ProfessorDocumentType.CORRECTION &&
      dto.examDocumentId
    ) {
      const exam = await this.prisma.document.findUnique({
        where: { id: dto.examDocumentId },
        select: { id: true, documentType: true },
      });
      if (!exam || exam.documentType !== ProfessorDocumentType.EXAM) {
        throw new BadRequestException("L'épreuve associée est introuvable ou n'est pas de type EXAM.");
      }

      return {
        correctionDocumentId: dto.examDocumentId,
        correctionVisibleAt: dto.correctionVisibleAt
          ? new Date(dto.correctionVisibleAt)
          : null,
      };
    }

    return {};
  }

  private mimeToExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'application/pdf': '.pdf',
      'image/jpeg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp',
    };
    return map[mimeType] ?? '';
  }
}
