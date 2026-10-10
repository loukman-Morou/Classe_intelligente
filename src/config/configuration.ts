export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsAllowedOrigins: string[];
  throttleTtlSeconds: number;
  throttleLimit: number;
  logLevel: string;
  /** Timeout global par requête HTTP en ms (défaut 30 000). */
  requestTimeoutMs: number;
}

export interface JwtConfig {
  accessSecret: string;
  accessTtl: string;
  refreshSecret: string;
  refreshTtl: string;
  authThrottleTtlSeconds: number;
  authThrottleLimit: number;
}

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  signedUrlTtlSeconds: number;
  maxFileSizeBytes: number;
  maxQuotaPerCourseBytes: number;
}

export interface RedisConfig {
  url: string;
}

export interface LifecycleConfig {
  inactiveAfterDays: number;
  archiveAfterDays: number;
  pendingDeletionAfterDays: number;
  deletedAfterDays: number;
  cron: string;
}

export interface AdminConfig {
  /**
   * Nombre maximum de comptes ADMIN simultanément actifs sur la plateforme.
   * Minimum 2 pour la résilience opérationnelle (perte d'un compte = toujours
   * au moins un admin actif). Configurable via MAX_ADMINS (défaut : 3).
   */
  maxAdmins: number;
}

export interface LlmConfig {
  /** Clé API OpenAI — jamais loggée, jamais exposée au frontend. */
  apiKey: string;
  /** Modèle d'embeddings. Dimension hardcodée à 1536 pour text-embedding-3-small. */
  embeddingModel: string;
  /** Modèle de complétion (chat). */
  chatModel: string;
  /** Nombre de chunks retournés par la recherche sémantique (top-K). */
  ragTopK: number;
  /**
   * Seuil de similarité cosinus minimum (0-1) sous lequel un chunk est ignoré.
   * Évite d'injecter du contenu non pertinent dans le prompt LLM.
   */
  ragSimilarityThreshold: number;
  /** Tokens maximum par réponse LLM. */
  maxTokens: number;
}

/**
 * Point d'entrée unique de lecture de `process.env`.
 * Le reste du code utilise `ConfigService.get<LlmConfig>('llm')` etc.
 * Jamais `process.env` directement dans les services.
 */
export default (): {
  app: AppConfig;
  jwt: JwtConfig;
  storage: StorageConfig;
  redis: RedisConfig;
  llm: LlmConfig;
  admin: AdminConfig;
} => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    throttleTtlSeconds: parseInt(process.env.THROTTLE_TTL_SECONDS ?? '60', 10),
    throttleLimit: parseInt(process.env.THROTTLE_LIMIT ?? '100', 10),
    logLevel: process.env.LOG_LEVEL ?? 'info',
    requestTimeoutMs: parseInt(process.env.REQUEST_TIMEOUT_MS ?? '30000', 10),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
    authThrottleTtlSeconds: parseInt(process.env.AUTH_THROTTLE_TTL_SECONDS ?? '60', 10),
    authThrottleLimit: parseInt(process.env.AUTH_THROTTLE_LIMIT ?? '5', 10),
  },
  storage: {
    endpoint: process.env.STORAGE_ENDPOINT ?? '',
    region: process.env.STORAGE_REGION ?? '',
    bucket: process.env.STORAGE_BUCKET ?? '',
    accessKey: process.env.STORAGE_ACCESS_KEY ?? '',
    secretKey: process.env.STORAGE_SECRET_KEY ?? '',
    signedUrlTtlSeconds: parseInt(process.env.STORAGE_SIGNED_URL_TTL_SECONDS ?? '900', 10),
    maxFileSizeBytes: parseInt(
      process.env.UPLOAD_MAX_FILE_SIZE_BYTES ?? String(50 * 1024 * 1024), 10,
    ),
    maxQuotaPerCourseBytes: parseInt(
      process.env.UPLOAD_MAX_QUOTA_PER_COURSE_BYTES ?? String(500 * 1024 * 1024), 10,
    ),
  },
  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },
  llm: {
    apiKey: process.env.OPENAI_API_KEY ?? '',
    embeddingModel: process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small',
    chatModel: process.env.CHAT_MODEL ?? 'gpt-4o-mini',
    ragTopK: parseInt(process.env.RAG_TOP_K ?? '6', 10),
    ragSimilarityThreshold: parseFloat(process.env.RAG_SIMILARITY_THRESHOLD ?? '0.70'),
    maxTokens: parseInt(process.env.LLM_MAX_TOKENS ?? '1000', 10),
  },
  admin: {
    maxAdmins: parseInt(process.env.MAX_ADMINS ?? '3', 10),
  },
  lifecycle: {
    inactiveAfterDays:       parseInt(process.env.LIFECYCLE_INACTIVE_AFTER_DAYS        ?? '90',  10),
    archiveAfterDays:        parseInt(process.env.LIFECYCLE_ARCHIVE_AFTER_DAYS         ?? '180', 10),
    pendingDeletionAfterDays: parseInt(process.env.LIFECYCLE_PENDING_DELETION_AFTER_DAYS ?? '365', 10),
    deletedAfterDays:        parseInt(process.env.LIFECYCLE_DELETED_AFTER_DAYS         ?? '30',  10),
    cron:                    process.env.LIFECYCLE_CRON ?? '0 2 * * *',
  },
});
