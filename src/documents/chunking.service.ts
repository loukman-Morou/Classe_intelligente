import { Injectable, Logger } from '@nestjs/common';

export interface TextChunk {
  index: number;
  content: string;
  /** Longueur approximative en tokens (1 token ≈ 4 caractères, heuristique). */
  tokenCount: number;
}

/**
 * Découpe un texte extrait en chunks appropriés pour l'indexation vectorielle.
 *
 * Stratégie retenue (simple et robuste) :
 *  1. Nettoyer le texte (whitespace redondant, caractères parasites).
 *  2. Couper d'abord aux frontières sémantiques naturelles : paragraphes,
 *     puis phrases si un paragraphe est trop long.
 *  3. Agréger jusqu'à la limite de tokens cible (~500 tokens ≈ 2000 chars).
 *  4. Ajouter un overlap de ~50 tokens entre chunks consécutifs pour que
 *     les réponses RAG ne ratent pas une information à cheval sur deux chunks.
 *
 * Pourquoi une heuristique chars/4 ≈ tokens : les vrais tokenizers (cl100k,
 * llama) ont un ratio proche de 4 pour le français. Une estimation en ±20 %
 * est suffisante — la borne dure en caractères empêche les dépassements.
 *
 * En Phase 8, le chunk sera envoyé au modèle d'embeddings. Sa longueur maximale
 * dépendra du modèle choisi — si on change de modèle, ajuster CHUNK_MAX_CHARS.
 */
@Injectable()
export class ChunkingService {
  private readonly logger = new Logger('ChunkingService');

  // ~500 tokens * 4 chars/token = 2000 chars max par chunk.
  private readonly CHUNK_MAX_CHARS = 2000;
  // ~50 tokens d'overlap * 4 = 200 chars conservés du chunk précédent.
  private readonly OVERLAP_CHARS   = 200;
  // Taille minimale pour qu'un chunk soit conservé (éviter les micro-chunks).
  private readonly MIN_CHUNK_CHARS = 100;

  /**
   * Nettoie, découpe et retourne les chunks prêts pour l'indexation.
   * @param rawText Texte brut issu de l'extraction PDF/OCR.
   */
  chunk(rawText: string): TextChunk[] {
    const cleaned = this.cleanText(rawText);

    if (cleaned.length < this.MIN_CHUNK_CHARS) {
      this.logger.warn(`Texte trop court après nettoyage (${cleaned.length} chars) — document ignoré ou vide.`);
      return [];
    }

    const segments = this.splitIntoSegments(cleaned);
    const chunks   = this.aggregateSegments(segments);

    this.logger.debug(
      `Chunking terminé : ${cleaned.length} chars → ${chunks.length} chunks`,
    );

    return chunks;
  }

  // --------------------------------------------------------------------------
  // 1. Nettoyage
  // --------------------------------------------------------------------------

  private cleanText(text: string): string {
    return text
      // Normaliser les fins de ligne.
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Supprimer les caractères de contrôle non imprimables (sauf \n\t).
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, ' ')
      // Réduire les espaces multiples horizontaux.
      .replace(/[ \t]+/g, ' ')
      // Réduire les lignes vides multiples à deux au maximum.
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // --------------------------------------------------------------------------
  // 2. Segmentation aux frontières naturelles
  // --------------------------------------------------------------------------

  private splitIntoSegments(text: string): string[] {
    // Couper d'abord aux doubles sauts de ligne (frontières de paragraphes).
    const paragraphs = text.split(/\n\n+/);
    const segments: string[] = [];

    for (const para of paragraphs) {
      const trimmed = para.trim();
      if (!trimmed) continue;

      if (trimmed.length <= this.CHUNK_MAX_CHARS) {
        // Le paragraphe entier tient dans un chunk.
        segments.push(trimmed);
      } else {
        // Paragraphe trop long → couper aux phrases.
        const sentences = this.splitIntoSentences(trimmed);
        segments.push(...sentences);
      }
    }

    return segments;
  }

  /**
   * Découpe un paragraphe long en phrases.
   * Heuristique simple : `.`, `!`, `?` suivis d'un espace et d'une majuscule.
   */
  private splitIntoSentences(text: string): string[] {
    // Regex : coupe après `.!?` si suivi d'un espace + majuscule ou fin de string.
    const parts = text.split(/(?<=[.!?])\s+(?=[A-ZÀÂÉÈÊËÎÏÔÙÛÜ])/);
    return parts.map((s) => s.trim()).filter((s) => s.length >= this.MIN_CHUNK_CHARS);
  }

  // --------------------------------------------------------------------------
  // 3. Agrégation avec overlap
  // --------------------------------------------------------------------------

  private aggregateSegments(segments: string[]): TextChunk[] {
    const chunks: TextChunk[] = [];
    let buffer = '';
    let index  = 0;

    for (const segment of segments) {
      // Si l'ajout du segment dépasse la limite, fermer le chunk courant.
      if (buffer.length > 0 && buffer.length + segment.length + 1 > this.CHUNK_MAX_CHARS) {
        chunks.push(this.makeChunk(index++, buffer));

        // Récupérer la fin du chunk précédent comme overlap pour le suivant.
        const overlap = buffer.slice(-this.OVERLAP_CHARS);
        buffer = overlap ? overlap + '\n' + segment : segment;
      } else {
        buffer = buffer ? buffer + '\n' + segment : segment;
      }
    }

    // Flush du dernier chunk.
    if (buffer.trim().length >= this.MIN_CHUNK_CHARS) {
      chunks.push(this.makeChunk(index, buffer));
    }

    return chunks;
  }

  private makeChunk(index: number, content: string): TextChunk {
    const trimmed = content.trim();
    return {
      index,
      content: trimmed,
      tokenCount: Math.round(trimmed.length / 4),
    };
  }
}
