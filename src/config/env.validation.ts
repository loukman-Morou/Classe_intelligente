import * as Joi from 'joi';

/**
 * Validation stricte des variables d'environnement.
 * L'application refuse de démarrer si une variable requise manque ou est invalide.
 * Les variables des phases futures sont déclarées dans .env.example mais PAS ici
 * tant que le code correspondant n'existe pas.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  CORS_ALLOWED_ORIGINS: Joi.string().required(),

  THROTTLE_TTL_SECONDS: Joi.number().integer().positive().default(60),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),

  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),

  // Phase 1 — Base de données.
  DATABASE_URL: Joi.string()
    .uri({ scheme: ['postgresql', 'postgres'] })
    .required(),

  // Phase 2 — JWT. Deux secrets distincts (fuite d'un seul = impact limité).
  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_TTL: Joi.string().default('30d'),

  // Rate limiting dédié /auth/login.
  AUTH_THROTTLE_TTL_SECONDS: Joi.number().integer().positive().default(60),
  AUTH_THROTTLE_LIMIT: Joi.number().integer().positive().default(5),

  // Phase 6 — Stockage privé compatible S3.
  STORAGE_ENDPOINT: Joi.string().uri().required(),
  STORAGE_REGION: Joi.string().required(),
  STORAGE_BUCKET: Joi.string().required(),
  STORAGE_ACCESS_KEY: Joi.string().required(),
  STORAGE_SECRET_KEY: Joi.string().required(),
  // Durée de vie des URLs signées download (secondes). 900 = 15 minutes.
  STORAGE_SIGNED_URL_TTL_SECONDS: Joi.number().integer().positive().default(900),

  // Phase 6/7 — Redis (BullMQ pour le pipeline document).
  REDIS_URL: Joi.string().uri({ scheme: ['redis', 'rediss'] }).required(),

  // Administration — plafond d'admins (résilience, voir docs/security.md §Admin).
  // Minimum 2 pour garantir la résilience opérationnelle.
  MAX_ADMINS: Joi.number().integer().min(2).max(10).default(3),

  // Limites upload (configurables sans redéploiement).
  UPLOAD_MAX_FILE_SIZE_BYTES: Joi.number()
    .integer()
    .positive()
    .default(50 * 1024 * 1024),           // 50 MB
  UPLOAD_MAX_QUOTA_PER_COURSE_BYTES: Joi.number()
    .integer()
    .positive()
    .default(500 * 1024 * 1024),          // 500 MB
  // Phase 8/9 — IA (OpenAI ou compatible)
  OPENAI_API_KEY: Joi.string().required(),
  EMBEDDING_MODEL: Joi.string().default('text-embedding-3-small'),
  CHAT_MODEL: Joi.string().default('gpt-4o-mini'),
  RAG_TOP_K: Joi.number().integer().min(1).max(20).default(6),
  RAG_SIMILARITY_THRESHOLD: Joi.number().min(0).max(1).default(0.70),

  // Phase 11 — Seuil d'anonymat radar pédagogique.
  ANALYTICS_MIN_THRESHOLD: Joi.number().integer().min(1).default(5),

  // Phase 13 — Cycle de vie des classes (durées en jours).
  // Valeurs conformes au cahier des charges §5 (validation juridique à prévoir).
  LIFECYCLE_INACTIVE_AFTER_DAYS:        Joi.number().integer().min(1).default(90),
  LIFECYCLE_ARCHIVE_AFTER_DAYS:         Joi.number().integer().min(1).default(180),
  LIFECYCLE_PENDING_DELETION_AFTER_DAYS: Joi.number().integer().min(1).default(365),
  LIFECYCLE_DELETED_AFTER_DAYS:         Joi.number().integer().min(1).default(30),
  // Cron de détection (défaut : chaque nuit à 2h UTC, hors pics d'usage).
  LIFECYCLE_CRON: Joi.string().default('0 2 * * *'),

  // Phase 14 — Timeout global par requête (ms).
  // Doit être supérieur aux timeouts internes LLM/OCR.
  REQUEST_TIMEOUT_MS: Joi.number().integer().positive().default(30_000),

  // Nombre maximum d'administrateurs (min 2 pour la résilience).
  MAX_ADMINS: Joi.number().integer().min(2).max(10).default(3),
});
