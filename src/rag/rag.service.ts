import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { LlmConfig } from '../config/configuration';

export interface RagChunk {
  chunkId: string;
  documentId: string;
  documentName: string;
  content: string;
  similarity: number;
}

export interface RagSearchParams {
  /** Question posée par l'utilisateur. */
  query: string;
  /** ID du cours autorisé — vérifié en amont par le guard, jamais par l'IA. */
  courseId: string;
  /** classId dénormalisé — double filtre de sécurité côté SQL. */
  classId: string;
  /** Nombre maximum de chunks à retourner (défaut : config RAG_TOP_K). */
  topK?: number;
}

/**
 * Service de recherche sémantique (RAG).
 *
 * =========================================================================
 * RÈGLE DE SÉCURITÉ FONDAMENTALE (docs/security.md §8) :
 *
 *   L'IA ne décide JAMAIS des permissions.
 *   Le filtrage classId/courseId est appliqué DANS LA REQUÊTE SQL,
 *   pas dans le code applicatif après coup.
 *
 *   Un chunk ne peut jamais remonter si son courseId ou classId
 *   ne correspondent pas exactement aux valeurs autorisées par le guard.
 *   Même un prompt injection réussi dans le contenu d'un document
 *   ne peut pas contourner ce filtre SQL.
 * =========================================================================
 *
 * Pipeline :
 *   1. Embed la question (vecteur de requête)
 *   2. Recherche cosinus pgvector avec filtre WHERE courseId + classId
 *   3. Seuil de similarité (reject chunks trop éloignés)
 *   4. Retourne les chunks avec métadonnées sources
 */
@Injectable()
export class RagService {
  private readonly logger = new Logger('RagService');
  private readonly topK: number;
  private readonly similarityThreshold: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embedding: EmbeddingService,
    private readonly config: ConfigService,
  ) {
    const cfg = this.config.getOrThrow<LlmConfig>('llm');
    this.topK = cfg.ragTopK;
    this.similarityThreshold = cfg.ragSimilarityThreshold;
  }

  /**
   * Recherche les chunks les plus pertinents pour une question.
   *
   * La requête SQL incorpore OBLIGATOIREMENT course_id ET class_id dans le WHERE,
   * même si l'un est redondant avec l'autre (défense en profondeur).
   * Jamais de confiance dans le contenu des chunks pour déterminer l'accès.
   */
  async search(params: RagSearchParams): Promise<RagChunk[]> {
    const { query, courseId, classId, topK = this.topK } = params;

    this.logger.debug(`RAG search — courseId=${courseId} classId=${classId} topK=${topK}`);

    // 1. Générer l'embedding de la question.
    const queryEmbedding = await this.embedding.embed(query);
    const vectorStr = EmbeddingService.formatVector(queryEmbedding);

    // 2. Recherche sémantique avec filtres de sécurité obligatoires.
    //
    //    Deux filtres cumulatifs (AND) :
    //      - dc.course_id = $courseId  →  isolation par cours
    //      - dc.class_id  = $classId   →  isolation par classe (défense en profondeur)
    //
    //    Le filtre status='READY' empêche de récupérer des chunks
    //    partiellement indexés ou issus de documents supprimés.
    //
    //    `1 - (embedding <=> $vector)` = similarité cosinus (0=différent, 1=identique).
    //    L'opérateur `<=>` est la distance cosinus pgvector.
    //
    //    IMPORTANT : on ne fait JAMAIS de filtre post-SQL sur le résultat
    //    (ex: filtrer les chunks côté TypeScript après la requête) —
    //    cela laisserait une fenêtre où des chunks non autorisés transitent
    //    en mémoire, même s'ils sont ensuite écartés.
    const rows = await this.prisma.$queryRaw<
      Array<{
        chunk_id: string;
        document_id: string;
        original_filename: string;
        content: string;
        similarity: number;
      }>
    >`
      SELECT
        dc.id                      AS chunk_id,
        dc.document_id             AS document_id,
        d.original_filename        AS original_filename,
        dc.content                 AS content,
        1 - (dc.embedding <=> ${vectorStr}::vector)  AS similarity
      FROM document_chunks dc
      JOIN documents d ON d.id = dc.document_id
      WHERE
        dc.course_id  = ${courseId}::uuid
        AND dc.class_id = ${classId}::uuid
        AND dc.embedding IS NOT NULL
        AND d.status = ${DocumentStatus.READY}
        AND (1 - (dc.embedding <=> ${vectorStr}::vector)) >= ${this.similarityThreshold}
      ORDER BY dc.embedding <=> ${vectorStr}::vector
      LIMIT ${topK}
    `;

    this.logger.debug(`RAG résultats : ${rows.length} chunks (seuil=${this.similarityThreshold})`);

    return rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentName: row.original_filename,
      content: row.content,
      similarity: Number(row.similarity),
    }));
  }

  /**
   * Indexe l'embedding d'un chunk existant (utilisé dans le worker OCR
   * et le job de backfill).
   *
   * L'update se fait via $executeRaw car Prisma ne supporte pas le type
   * vector(1536) nativement.
   */
  async indexChunk(chunkId: string, content: string): Promise<void> {
    const embeddingVector = await this.embedding.embed(content);
    const vectorStr = EmbeddingService.formatVector(embeddingVector);

    await this.prisma.$executeRaw`
      UPDATE document_chunks
      SET embedding = ${vectorStr}::vector
      WHERE id = ${chunkId}::uuid
    `;
  }

  /**
   * Indexe tous les chunks d'un document après OCR (batch).
   * Appelé par OcrWorker après la création des chunks.
   */
  async indexDocument(documentId: string): Promise<void> {
    const chunks = await this.prisma.documentChunk.findMany({
      where: { documentId, embedding: null },
      select: { id: true, content: true },
      orderBy: { chunkIndex: 'asc' },
    });

    if (chunks.length === 0) {
      this.logger.debug(`indexDocument : aucun chunk sans embedding — documentId=${documentId}`);
      return;
    }

    this.logger.log(`Indexation ${chunks.length} chunks — documentId=${documentId}`);

    // Générer tous les embeddings en batch (minimise les appels API).
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embedding.embedBatch(texts);

    // Mettre à jour les chunks un à un via $executeRaw.
    // Pas de transaction ici : une coupure réseau partielle laissera certains
    // chunks indexés et d'autres non (embedding IS NULL), ce que le backfill
    // détecte et relance proprement.
    for (let i = 0; i < chunks.length; i++) {
      const vectorStr = EmbeddingService.formatVector(embeddings[i]);
      await this.prisma.$executeRaw`
        UPDATE document_chunks
        SET embedding = ${vectorStr}::vector
        WHERE id = ${chunks[i].id}::uuid
      `;
    }

    this.logger.log(`Indexation terminée — documentId=${documentId} chunks=${chunks.length}`);
  }
}
