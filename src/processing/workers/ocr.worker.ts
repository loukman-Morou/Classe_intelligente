import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DocumentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { OcrService } from '../../ocr/ocr.service';
import { ChunkingService } from '../../documents/chunking.service';
import { RagService } from '../../rag/rag.service';
import { OCR_QUEUE, OcrJobData } from '../processing-producer.service';

/**
 * Worker BullMQ qui traite les jobs OCR.
 *
 * Pipeline :
 *   QUEUED → [worker reçoit le job]
 *   PROCESSING → téléchargement S3 + extraction texte + nettoyage + chunking
 *   READY → DocumentChunks insérés, statut Document → READY
 *   FAILED → statut Document → FAILED, errorMessage enregistré
 *
 * Ce worker tourne dans le même process NestJS que l'API mais pourrait
 * être extrait dans un process séparé en Phase 15 (Production) si la charge
 * le justifie — l'architecture BullMQ le supporte nativement.
 *
 * SÉCURITÉ :
 *  - Le fichier est téléchargé en mémoire (Buffer) — jamais écrit sur disque
 *    avec le nom original.
 *  - Les erreurs sont loggées complètement côté serveur mais le message
 *    stocké en DB est non sensible (pas de stack trace, pas de chemin interne).
 *  - Chaque job est isolé : une erreur sur un document n'affecte pas les autres.
 */
@Processor(OCR_QUEUE)
export class OcrWorker extends WorkerHost {
  private readonly logger = new Logger('OcrWorker');

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly ocr: OcrService,
    private readonly chunking: ChunkingService,
    private readonly rag: RagService,
  ) {
    super();
  }

  async process(job: Job<OcrJobData>): Promise<void> {
    const { documentId, courseId } = job.data;
    this.logger.log(`Job OCR démarré — documentId=${documentId} jobId=${job.id}`);

    // Marquer le job DB en PROCESSING.
    await this.updateJobStatus(documentId, 'PROCESSING');

    try {
      // 1. Charger le document depuis la DB.
      const document = await this.prisma.document.findUnique({
        where: { id: documentId },
        select: { id: true, storageKey: true, mimeType: true, status: true },
      });

      if (!document) {
        throw new Error(`Document introuvable en DB : ${documentId}`);
      }

      if (document.status === DocumentStatus.DELETED) {
        this.logger.warn(`Document supprimé avant traitement : ${documentId} — job annulé.`);
        await this.updateJobStatus(documentId, 'DONE'); // pas un échec, juste obsolète
        return;
      }

      // 2. Télécharger le fichier depuis S3 en mémoire.
      const fileBuffer = await this.downloadFromStorage(document.storageKey);

      // 3. Extraire le texte.
      let rawText: string;
      try {
        rawText = await this.ocr.extractText(fileBuffer, document.mimeType);
      } catch (extractErr: unknown) {
        // PDF sans couche texte → tenter l'OCR image comme fallback.
        if (
          extractErr instanceof Error &&
          extractErr.message === 'PDF_NO_TEXT_LAYER' &&
          document.mimeType === 'application/pdf'
        ) {
          this.logger.warn(`PDF sans couche texte — fallback OCR image : ${documentId}`);
          rawText = await this.ocr.extractText(fileBuffer, 'image/png');
        } else {
          throw extractErr;
        }
      }

      if (!rawText || rawText.trim().length === 0) {
        throw new Error('Aucun texte extrait du document.');
      }

      // 4. Découper en chunks.
      const chunks = this.chunking.chunk(rawText);

      if (chunks.length === 0) {
        throw new Error('Le document ne contient pas de texte suffisant pour être indexé.');
      }

      // 5. Récupérer le classId pour la dénormalisation (filtrage RAG Phase 8).
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
        select: { classId: true },
      });

      if (!course) {
        throw new Error(`Cours introuvable : ${courseId}`);
      }

      // 6. Insérer les chunks + passer le document à READY, en transaction.
      await this.prisma.$transaction(async (tx) => {
        // Supprimer les éventuels anciens chunks (retraitement après échec).
        await tx.documentChunk.deleteMany({ where: { documentId } });

        // Insérer les nouveaux chunks (classId dénormalisé pour le RAG).
        await tx.documentChunk.createMany({
          data: chunks.map((chunk) => ({
            documentId,
            courseId,
            classId: course.classId ?? '',
            chunkIndex: chunk.index,
            content: chunk.content,
          })),
        });

        // Passer le document à READY.
        await tx.document.update({
          where: { id: documentId },
          data: { status: DocumentStatus.READY },
        });
      });

      // 7. Indexer les embeddings (hors transaction — voir RagService.indexDocument).
      await this.rag.indexDocument(documentId);

      // 7. Mettre à jour le job DB.
      await this.updateJobStatus(documentId, 'DONE');

      this.logger.log(
        `Job OCR terminé — documentId=${documentId} chunks=${chunks.length}`,
      );
    } catch (error: unknown) {
      // Logguer le détail complet côté serveur pour le diagnostic.
      this.logger.error(
        `Échec traitement documentId=${documentId}`,
        error instanceof Error ? error.stack : String(error),
      );

      // Stocker un message non sensible en DB (pas de stack trace, pas de chemin).
      const safeMessage = this.extractSafeMessage(error);

      await this.prisma.$transaction([
        this.prisma.document.update({
          where: { id: documentId },
          data: { status: DocumentStatus.FAILED },
        }),
        this.prisma.processingJob.updateMany({
          where: { documentId, status: { in: ['QUEUED', 'PROCESSING'] } },
          data: { status: 'FAILED', errorMessage: safeMessage },
        }),
      ]);

      // Re-lancer l'erreur pour que BullMQ gère les retries configurés.
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Helpers privés
  // --------------------------------------------------------------------------

  /**
   * Télécharge le fichier depuis S3 et retourne un Buffer.
   * L'URL signée est générée côté serveur — jamais exposée au client ici.
   */
  private async downloadFromStorage(storageKey: string): Promise<Buffer> {
    // StorageService génère une URL signée ; on la consomme immédiatement.
    // Alternative plus propre en prod : utiliser le SDK S3 directement pour
    // un GetObject sans URL intermédiaire — à optimiser en Phase 15.
    const signedUrl = await this.storage.getDownloadUrl(storageKey);

    const response = await fetch(signedUrl);
    if (!response.ok) {
      throw new Error(`Impossible de télécharger le fichier S3 (status ${response.status}).`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private async updateJobStatus(
    documentId: string,
    status: 'PROCESSING' | 'DONE' | 'FAILED',
  ): Promise<void> {
    await this.prisma.processingJob.updateMany({
      where: { documentId, status: { in: ['QUEUED', 'PROCESSING'] } },
      data: { status },
    });
  }

  /**
   * Extrait un message d'erreur court et non sensible pour la DB.
   * Ne jamais stocker de stack trace, de chemin système ou de secret.
   */
  private extractSafeMessage(error: unknown): string {
    if (!(error instanceof Error)) return 'Erreur inconnue lors du traitement.';

    // Messages identifiables → réponses lisibles sans information interne.
    const safePatterns: [RegExp, string][] = [
      [/PDF_NO_TEXT_LAYER/, 'Le PDF ne contient pas de couche texte reconnaissable.'],
      [/Timeout/, 'Délai d\'extraction dépassé — document potentiellement corrompu.'],
      [/Aucun texte extrait/, 'Le document semble vide ou non lisible.'],
      [/pas de texte suffisant/, 'Contenu textuel insuffisant pour l\'indexation.'],
    ];

    for (const [pattern, message] of safePatterns) {
      if (pattern.test(error.message)) return message;
    }

    // Fallback générique — ne jamais inclure error.message brut (peut contenir
    // des chemins système, des clés S3, etc.).
    return 'Erreur lors du traitement du document. Réessayez ou contactez le support.';
  }
}
