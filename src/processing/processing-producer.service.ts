import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { PrismaService } from '../prisma/prisma.service';

export const OCR_QUEUE = 'ocr-processing';
export const PURGE_QUEUE = 'storage-purge';

export interface OcrJobData {
  documentId: string;
  courseId: string;
}

export interface PurgeJobData {
  storageKey: string;
  documentId: string;
}

@Injectable()
export class ProcessingProducerService {
  private readonly logger = new Logger('ProcessingProducer');

  constructor(
    @InjectQueue(OCR_QUEUE) private readonly ocrQueue: Queue,
    @InjectQueue(PURGE_QUEUE) private readonly purgeQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Enfile un job OCR pour un document qui vient d'être uploadé et validé.
   * Le statut DB passe à PROCESSING immédiatement (déjà fait par DocumentsService.completeUpload).
   * Le job BullMQ sera traité par le worker OCR (Phase 7).
   */
  async enqueueOcr(documentId: string, courseId: string): Promise<void> {
    const jobData: OcrJobData = { documentId, courseId };

    const job = await this.ocrQueue.add('ocr', jobData, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: { age: 86400 },  // garder 24h pour debug
      removeOnFail: { age: 604800 },     // garder 7j pour audit
    });

    // Tracer le job en DB pour que le frontend puisse consulter le statut
    // sans interroger Redis directement.
    await this.prisma.processingJob.create({
      data: {
        documentId,
        jobType: 'OCR',
        bullJobId: String(job.id),
        status: 'QUEUED',
      },
    });

    this.logger.log(`Job OCR enfilé : documentId=${documentId} bullJobId=${job.id}`);
  }

  /**
   * Enfile un job de purge physique S3 pour un document logiquement supprimé.
   * Délai de 1 heure : laisse le temps d'annuler une suppression accidentelle
   * (côté admin, Phase 12) avant destruction irréversible.
   */
  async enqueuePurge(documentId: string, storageKey: string): Promise<void> {
    const jobData: PurgeJobData = { documentId, storageKey };

    await this.purgeQueue.add('purge', jobData, {
      delay: 60 * 60 * 1000, // 1 heure
      attempts: 5,
      backoff: { type: 'exponential', delay: 10000 },
      removeOnComplete: { age: 86400 },
      removeOnFail: { age: 604800 },
    });

    this.logger.log(`Job de purge enfilé : documentId=${documentId} storageKey=${storageKey}`);
  }
}
