import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { LlmConfig } from '../config/configuration';

/**
 * Service de génération d'embeddings.
 *
 * Utilise l'API OpenAI (text-embedding-3-small, 1536 dimensions).
 * Compatible avec tout fournisseur proposant l'API OpenAI (Azure OpenAI,
 * Mistral, etc.) en changeant OPENAI_BASE_URL dans l'environnement.
 *
 * SÉCURITÉ :
 *  - La clé API n'est jamais loggée ni retournée dans une réponse.
 *  - Les textes envoyés à l'API sont des contenus de chunks — jamais des
 *    données personnelles directes (noms, emails, tokens...).
 *  - En cas d'erreur de l'API, on lève une exception — jamais de fallback
 *    silencieux qui produirait un embedding nul (risque de faux positifs RAG).
 */
@Injectable()
export class EmbeddingService implements OnModuleInit {
  private readonly logger = new Logger('EmbeddingService');
  private client!: OpenAI;
  private model!: string;

  /** Dimension du modèle — doit correspondre à la migration SQL (vector(1536)). */
  static readonly DIMENSIONS = 1536;

  /**
   * Nombre maximum de chunks envoyés en une seule requête API.
   * text-embedding-3-small : limite 2048 inputs par batch.
   */
  private static readonly BATCH_SIZE = 100;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const cfg = this.config.getOrThrow<LlmConfig>('llm');
    this.model = cfg.embeddingModel;

    this.client = new OpenAI({
      apiKey: cfg.apiKey,
      // Permet de pointer vers Azure OpenAI ou tout proxy compatible.
      baseURL: process.env.OPENAI_BASE_URL,
    });

    this.logger.log(`EmbeddingService initialisé — modèle: ${this.model}`);
  }

  /**
   * Génère l'embedding d'un texte unique.
   * Retourne un tableau de 1536 floats (cosinus similarity).
   */
  async embed(text: string): Promise<number[]> {
    const results = await this.embedBatch([text]);
    return results[0];
  }

  /**
   * Génère les embeddings d'un tableau de textes en batch.
   * Découpe automatiquement en sous-batches pour respecter les limites API.
   * Retourne les embeddings dans le même ordre que l'entrée.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += EmbeddingService.BATCH_SIZE) {
      const batch = texts.slice(i, i + EmbeddingService.BATCH_SIZE);

      this.logger.debug(
        `Embedding batch ${Math.floor(i / EmbeddingService.BATCH_SIZE) + 1} : ${batch.length} textes`,
      );

      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
        encoding_format: 'float',
      });

      // Vérification de dimension — défense contre un changement de modèle
      // non répercuté dans la migration SQL (vector(1536)).
      for (const item of response.data) {
        if (item.embedding.length !== EmbeddingService.DIMENSIONS) {
          throw new Error(
            `Dimension d'embedding inattendue : ${item.embedding.length} ` +
            `(attendu: ${EmbeddingService.DIMENSIONS}). ` +
            `Vérifiez que EMBEDDING_MODEL correspond à la migration pgvector.`,
          );
        }
        results.push(item.embedding);
      }
    }

    return results;
  }

  /**
   * Formate un vecteur float[] en chaîne PostgreSQL `[a,b,c,...]`.
   * Utilisé dans les requêtes $queryRaw où pgvector attend ce format.
   */
  static formatVector(embedding: number[]): string {
    return `[${embedding.join(',')}]`;
  }
}
