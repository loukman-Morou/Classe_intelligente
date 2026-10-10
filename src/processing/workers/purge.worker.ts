import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { PURGE_QUEUE, PurgeJobData } from '../processing-producer.service';

/**
 * Worker de suppression physique S3.
 *
 * Déclenché avec 1h de délai après la suppression logique (Document.status = DELETED).
 * Ce délai laisse le temps à un admin (Phase 12) d'annuler une suppression
 * accidentelle avant que le fichier soit irrémédiablement perdu.
 *
 * Garde-fous :
 *  - Vérifie que le document est bien toujours en statut DELETED avant de purger
 *    (un admin aurait pu le restaurer pendant le délai).
 *  - En cas d'échec S3, retry jusqu'à 5 fois (exponentiel) — la suppression
 *    logique empêche déjà l'accès, donc pas d'urgence mais la purge doit finir.
 *  - Log complet côté serveur, rien de sensible en DB.
 */
@Processor(PURGE_QUEUE)
export class PurgeWorker extends WorkerHost {
  private readonly logger = new Logger('PurgeWorker');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {
    super();
  }

  async process(job: Job<PurgeJobData>): Promise<void> {
    const { documentId, storageKey } = job.data;
    this.logger.log(`Job PURGE démarré — documentId=${documentId} jobId=${job.id}`);

    // Vérifier que le document est toujours en statut DELETED.
    // Si un admin a restauré le document (Phase 12), on ne purge pas.
    const document = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: { id: true, status: true },
    });

    if (!document) {
      // Document introuvable en DB (déjà purgé ou jamais existé).
      this.logger.warn(`Document ${documentId} introuvable — suppression S3 ignorée.`);
      return;
    }

    if (document.status !== DocumentStatus.DELETED) {
      // Le document a été restauré entre la suppression logique et ce job.
      this.logger.log(
        `Document ${documentId} restauré (statut: ${document.status}) — purge annulée.`,
      );
      return;
    }

    // Supprimer l'objet S3.
    await this.storage.deleteObject(storageKey);

    // Supprimer aussi les chunks DB (ils ne servent plus à rien sans le fichier).
    await this.prisma.documentChunk.deleteMany({ where: { documentId } });

    this.logger.log(
      `Purge physique terminée — documentId=${documentId} storageKey=${storageKey}`,
    );
  }
}
