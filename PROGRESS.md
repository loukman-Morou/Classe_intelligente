# PROGRESS — CLASSE INTELLIGENTE

> Fichier de suivi du développement backend.
> Lire ce fichier avant toute tâche backend.
> Ne pas détailler ici l'architecture : elle se trouve dans `backend-architecture.md`.

---

## ÉTAT ACTUEL

Phase : 15 — Production (COMPLÉTÉ)
Fonctionnalité en cours : Aucune.
Statut : TOUTES LES PHASES (0 à 15) IMPLÉMENTÉES. Backend prêt pour review finale.

---

## DÉCISION PRISE — responsable(s) de classe

Question posée : `ownerId` unique (contrat API) vs 1-à-2-responsables (prompt maître
initial) ? Réponse : **responsable principal obligatoire (`Class.ownerId`) + un
co-responsable optionnel (`Class.coOwnerId`, nullable)**.

Conséquences déjà appliquées :
- `ClassMember.isResponsible` retiré : `ClassMember` n'atteste plus que
  l'appartenance à la classe, la notion de responsable vit uniquement sur `Class`.
- Trigger Postgres `trg_enforce_max_two_responsibles` **supprimé** (devenu inutile :
  "au plus 1 co-responsable" est garanti par construction avec une colonne à valeur
  unique, pas besoin de compter/contraindre).
- Reste à faire en Phase 3 : attribution du co-responsable via une mise à jour
  conditionnelle atomique (`UPDATE ... WHERE co_owner_id IS NULL`), pas un
  `SELECT` + `UPDATE` séparés — voir `docs/database.md` §Concurrence.
- `docs/api-contract.md` mis à jour avec `coOwnerId` (absent du contrat fourni
  initialement) — à reporter dans votre copie de référence si vous en gardez une.

---

## PHASES

### Phase 0 — Initialisation
- [x] Structure du backend
- [x] NestJS + TypeScript
- [x] Configuration environnement (ConfigModule + validation Joi, échec au démarrage si invalide)
- [x] `.env.example`
- [x] `.gitignore`
- [x] Gestion globale des erreurs (`AllExceptionsFilter`, format standard, aucune fuite)
- [x] Logging (requestId, pino redacté, `LoggingInterceptor` structuré)
- [x] Validation globale (`ValidationPipe` whitelist/forbidNonWhitelisted/transform)
- [x] Sécurité de base (Helmet, CORS restreint par env, rate limiting global `ThrottlerModule`)
- [x] Health check (`GET /api/v1/health`, exclu du rate limiting)

> Non exécuté dans ce sandbox (pas d'accès réseau pour `npm install`) : à valider en local
> avec `npm install && npm run lint && npm run test && npm run test:e2e`.

### Phase 1 — Base de données
- [x] PostgreSQL (docker-compose.yml, image `pgvector/pgvector:pg16`)
- [x] Prisma (`prisma/schema.prisma`, `PrismaService`/`PrismaModule`, health check DB)
- [x] User (+ `firstName`/`lastName`, alignés sur `docs/api-contract.md`)
- [x] Class (`academicYear`/`description`, `ownerId` obligatoire, `coOwnerId` optionnel)
- [x] ClassMember (appartenance uniquement — plus de flag responsable, voir décision ci-dessus)
- [x] Course
- [x] CourseProfessor
- [x] Invitation (table `course_invitations`, tokenHash uniquement)
- [x] Document
- [x] Conversation
- [x] Message
- [x] Quiz (+ QuizQuestion)
- [x] AuditLog
- [x] Contraintes et index (onDelete explicites par relation, voir `docs/database.md`)
- [ ] Migrations — schéma écrit mais **non généré/appliqué** dans ce sandbox (pas
      d'accès réseau au moteur Prisma) ; à lancer en local :
      `npx prisma migrate dev --name init_schema` (plus de migration manuelle à
      appliquer ensuite : le trigger de responsables a été retiré, devenu inutile
      avec le modèle owner/co-owner).

Ajouté au-delà de la checklist initiale, à la demande du cahier des charges fourni
(`docs/cahier-des-charges.md` §20, table list §17) :
- [x] QuestionTopic, QuestionAnalytics, PedagogicalInsight (structure de données du
      radar pédagogique — alimentation/logique reportée à la Phase 11)

### Phase 2 — Authentification
- [x] Register (Argon2id, email normalisé, sans passwordHash dans la réponse)
- [x] Login (timing constant anti-énumération, message d'erreur unique)
- [x] Access token (JWT court, 15m, secret dédié)
- [x] Refresh token (JWT long, 30j, secret distinct, hash SHA-256 en DB)
- [x] Logout (révocation idempotente)
- [x] Révocation des sessions (toutes les sessions d'un user : `revokeAllUserTokens`)
- [x] `/auth/me` (rechargement DB, jamais données du seul payload JWT)
- [x] Rate limiting dédié /auth/login (5 req/60 s par défaut, écrase le global)
- [x] Protection brute force (ThrottlerGuard + rotation avec détection de rejeu)
- [x] Tests sécurité (auth.service.spec.ts : 12 cas dont anti-énumération, rejeu,
      suspension, token révoqué, idempotence logout)

Dépendances ajoutées : `@nestjs/jwt`, `@nestjs/passport`, `argon2`, `passport`,
`passport-jwt`. À installer : `npm install`.
Migration nécessaire : `npx prisma migrate dev --name add_refresh_tokens` (ajout du
modèle `RefreshToken` au schéma).

### Phase 3 — Classes
- [x] Créer une classe (joinCode unique 8 chars, owner inscrit en ClassMember dans la même transaction)
- [x] Modifier une classe (PATCH partiel, owner/co-owner uniquement)
- [x] Consulter une classe (GET, membres uniquement, IDOR bloqué par ClassMemberGuard)
- [x] Lister les classes du user (owner + co-owner + membre)
- [x] Rejoindre une classe via code court (POST /classes/join, idempotent sur conflit P2002)
- [x] Gérer les membres (GET list paginée, DELETE membre — owner/co-owner)
- [x] Promouvoir un co-responsable (POST /classes/:id/co-owner, atomique WHERE coOwnerId IS NULL)
- [x] Rétrograder / retirer le co-responsable (DELETE /classes/:id/co-owner)
- [x] Protection contre les conditions de concurrence (updateMany retourne count=0 → 409)
- [x] Owner principal non supprimable via l'API publique
- [x] Archivage (POST /classes/:id/archive, owner principal uniquement)
- [x] Réactivation (POST /classes/:id/restore, owner principal uniquement)
- [x] Dashboard stats (GET /classes/:id/dashboard)
- [x] Audit de toutes les actions sensibles (AuditService)
- [x] Guards : ClassMemberGuard (membership), ClassOwnerGuard (owner/co-owner), chainables
- [x] Tests unitaires (15 cas : création, modification, rejoindre, co-owner race condition,
      retrait membre, archivage, IDOR)

### Phase 4 — Cours
- [x] Créer un cours (POST /classes/:classId/courses, owner/co-owner, unicité du nom dans la classe)
- [x] Modifier un cours (PATCH /courses/:courseId, owner/co-owner, unicité sur rename)
- [x] Supprimer un cours (DELETE, bloqué si documents ou conversations existent)
- [x] Lister les cours (GET /classes/:classId/courses, filtré par rôle)
- [x] Permissions par cours (CourseAccessGuard : résout CLASS_OWNER/CLASS_CO_OWNER/COURSE_PROFESSOR/STUDENT)
- [x] Isolation PROFESSOR (ne voit que ses cours assignés via CourseProfessor)
- [x] Isolation cross-class (courseId rechargé depuis la DB, classId vérifié)
- [x] Lister/retirer les professeurs d'un cours (owner/co-owner)
- [x] Tests d'isolation (16 cas : rôles, IDOR, création, suppression gardée, professeur non assigné)

### Phase 5 — Espace Professeur
- [x] Schéma DB : ProfessorCourse, CourseVersion, ClassCourse, CourseUpdateProposal, Document enrichi (type, correctionDocumentId, correctionVisibleAt, sourceProfessorCourseId)
- [x] Enums : CourseShareStatus, CourseSyncStatus, ProposalStatus, ProposalType, ProfessorDocumentType
- [x] Course.classId rendu nullable (NULL = espace professeur, non-null = copie classe)
- [x] createCourse (POST /professor/courses) — transaction : Course + ProfessorCourse + CourseVersion initiale
- [x] findMyCourses (GET /professor/courses) — avec classCourses et syncStatus
- [x] shareCourseToClass (POST /professor/courses/:id/share) — copie indépendante + ClassCourse atomique
- [x] revokeShare (DELETE /professor/courses/:id/share/:classId) — statut REVOKED
- [x] proposeUpdate (POST /professor/courses/:id/proposals) — une seule PENDING par classe à la fois
- [x] cancelProposal (DELETE /professor/proposals/:id/cancel) — recalcul syncStatus
- [x] reviewProposal / acceptProposal / rejectProposal — côté responsable classe
- [x] getPedagogicalRadar (GET /professor/radar) — cross-classes, seuil anonymat = 5
- [x] getPendingProposalsForClass (GET /classes/:classId/proposals)
- [x] ProfessorRoleGuard, ProfessorCourseOwnerGuard (attache profCourseContext)
- [x] CourseSharesModule : accept/reject/cancel proposals côté classe
- [x] Tests unitaires (21 cas : création, partage, révocation, proposals, seuil d'anonymat)

### Phase 6 — Documents
- [x] StorageService (S3 compatible : presigned upload/download/delete, forcePathStyle pour R2/MinIO)
- [x] FileValidationService (allowlist MIME, vérification magic bytes : PDF/JPEG/PNG)
- [x] ProcessingProducerService (BullMQ : OCR queue + PURGE queue, retry exponentiel)
- [x] requestUploadUrl (POST /courses/:courseId/documents/upload-url) — storageKey serveur, quota, MIME
- [x] completeUpload (POST /documents/:id/complete) — magic bytes + enqueue OCR
- [x] findAllForCourse (GET /courses/:courseId/documents) — storageKey JAMAIS dans la réponse
- [x] getDownloadUrl (GET /documents/:id/download) — URL signée 15 min, corrigé bloqué avant date
- [x] remove (DELETE /documents/:id) — suppression logique, purge S3 asynchrone
- [x] Quota par cours configurable (UPLOAD_MAX_QUOTA_PER_COURSE_BYTES)
- [x] STUDENT bloqué à l'upload (controller guard)
- [x] ProcessingJob tracé en DB (suivi statut sans interroger Redis directement)
- [x] env.validation.ts nettoyé (doublon supprimé), S3/Redis requis dès Phase 6
- [x] Tests unitaires (18 cas : magic bytes, quotas, MIME, corrigé visible/bloqué, storageKey masqué)

### Phase 7 — OCR / Traitement
- [x] OcrService — extraction texte PDF (pdf-parse) + OCR images (tesseract.js fra+eng)
- [x] Fallback PDF scanné → OCR image si aucune couche texte détectée (PDF_NO_TEXT_LAYER)
- [x] Timeout configurable (PDF: 30s, image: 120s) — documents corrompus ne bloquent pas
- [x] ChunkingService — nettoyage (contrôles, \r\n, espaces), découpage paragraphes + overlap 200 chars
- [x] Paragraphe trop long → découpage par phrases (cohérence sémantique préservée)
- [x] tokenCount approximatif (chars/4) pour monitoring
- [x] OcrWorker (BullMQ) — pipeline complet : DB → S3 download → extract → chunk → createMany + READY (transaction)
- [x] Document DELETED avant traitement → job annulé proprement (pas d'erreur)
- [x] FAILED → message safe en DB (pas de stack trace ni chemin système)
- [x] PurgeWorker — garde-fou restauration (vérifie statut DELETED avant suppression S3)
- [x] classId dénormalisé sur DocumentChunk (filtrage RAG Phase 8 sans jointure)
- [x] DocumentsModule exportant ChunkingService
- [x] Tests unitaires (20 cas : chunking overlap/nettoyage/indices, worker pipeline, FAILED safe, purge annulée)

### Phase 8 — RAG
- [x] EmbeddingService (OpenAI text-embedding-3-small 1536D, batch 100, vérification dimension)
- [x] Compatible Azure OpenAI / Mistral via OPENAI_BASE_URL
- [x] RagService.search — $queryRaw avec double filtre SQL WHERE courseId AND classId
- [x] Seuil de similarité configurable (RAG_SIMILARITY_THRESHOLD, défaut 0.70)
- [x] topK configurable par requête (RAG_TOP_K, défaut 6)
- [x] RagService.indexChunk + indexDocument (batch embeddings → $executeRaw)
- [x] Indexation partielle tolérée (embedding IS NULL = à réindexer, backfill safe)
- [x] OcrWorker branché sur RagService.indexDocument après chunking
- [x] Migration SQL manuelle pgvector :
  - phase8_pgvector_embeddings.sql (CREATE EXTENSION + ALTER TABLE ADD COLUMN)
  - phase8_pgvector_indexes.sql (HNSW m=16/ef=64 + index partiel embedding NOT NULL)
- [x] DocumentChunk.embedding déclaré Unsupported("vector(1536)") dans schema.prisma
- [x] openai SDK ajouté au package.json
- [x] RagModule branché dans AppModule
- [x] Tests unitaires (15 cas : formatVector, dim check, search isolation courseId/classId,
      topK, indexDocument batch, prompt injection documenté)

### Phase 9 — IA / Chat
- [x] PromptBuilderService — séparation stricte SYSTEM/USER/DOCUMENT
- [x] Prompt système fixe côté serveur (jamais modifiable par env ou client)
- [x] Chunks injectés dans <document_context> avec attributs XML sanitisés
- [x] sanitizeContent : balises XML échappées (fermeture prématurée du contexte impossible)
- [x] sanitizeAttr : guillemets échappés dans les noms de document
- [x] Historique limité à 10 tours (20 messages), rechargé depuis la DB
- [x] AiService.chat — pipeline complet : conversation → history → RAG → prompt → LLM → persist
- [x] Conversation résolue/créée avec vérification IDOR (courseId + userId)
- [x] fromCourseContext : distingue réponse documentaire vs connaissances générales
- [x] Mode anonyme : isAnonymous persisté, userId stocké en DB mais masqué dans les réponses
- [x] getConversations : STUDENT voit ses propres conv, owner/co-owner voit tout
- [x] userId masqué pour conv anonymes même pour owner/co-owner
- [x] getConversationById : résout le courseRole en interne (route sans :courseId)
- [x] Bug corrigé : GET /conversations/:id n'utilisait pas @CourseCtx() sans guard
- [x] Rate limiting 20 req/min sur POST /chat (LLM coûteux)
- [x] Tests unitaires (20 cas : prompt structure, sanitisation, IDOR, anonymat, fromCourseContext)
- [x] getConversation : vérification IDOR + règle anonymat
- [x] AuditService appelé en non-bloquant (void, jamais de throw)
- [x] Rate limiting dédié chat (20 req/min, distinct du throttle global)
- [x] LlmConfig.maxTokens ajouté à configuration.ts
- [x] AiModule branché dans AppModule
- [x] Tests unitaires (22 cas : prompt injection, sanitisation, IDOR conv, anonymat, fromCourseContext)

### Phase 10 — Révision
- [x] RevisionService — pipeline complet : RAG search → prompt → LLM (json_object) → parse/validate
- [x] QuizType : MCQ, OPEN, FLASHCARD, SUMMARY (même endpoint, comportement selon type)
- [x] QuizDifficulty : EASY, MEDIUM, HARD
- [x] Prompt système fixe par type (constante TypeScript, jamais de contenu utilisateur)
- [x] Contexte documentaire isolé dans <document_context> (même pattern que AiService)
- [x] topic injecté dans le userPrompt uniquement, tronqué à 200 chars
- [x] Validation stricte du JSON LLM (chaque champ vérifié, correctIndex borné)
- [x] BadRequestException sur JSON invalide (pas de 500 serveur)
- [x] assertDocumentBelongsToCourse : IDOR bloqué (documentId cross-cours → 403)
- [x] POST /courses/:courseId/quizzes/generate (rate limit 10 req/min)
- [x] POST /courses/:courseId/quizzes (persistance QCM)
- [x] GET /courses/:courseId/quizzes (liste)
- [x] GET /courses/:courseId/quizzes/:quizId (détail, appartenance vérifiée)
- [x] POST /courses/:courseId/summaries (alias sémantique résumé)
- [x] QuizzesModule branché dans AppModule
- [x] Tests unitaires (16 cas : types, JSON invalide, IDOR documentId, topic XSS, saveQuiz)

### Phase 11 — Radar pédagogique
- [x] AnalyticsService.recordQuestion — classifie la question via LLM (json_object, max 50 tokens), upsert atomique ($transaction), fire-and-forget (jamais d'impact sur le chat)
- [x] topic normalisé (trim + max 60 chars), null = skip silencieux
- [x] Topics regroupés avec les existants (contexte passé au LLM pour cohérence)
- [x] AnalyticsService.getCourseRadar — WHERE questionCount >= MIN_THRESHOLD (en DB, pas en TS)
- [x] AnalyticsService.getProfessorRadar — cross-classes, seuil par classe ET seuil total
- [x] PedagogicalInsightsService.generateForCourse — LLM génère suggestions, sévérité calculée par règle métier (questionCount prime sur LLM, anti-manipulation)
- [x] computeSeverity : HIGH >= 30, MEDIUM >= 15, LOW >= seuil (guard-fou LLM)
- [x] PedagogicalInsightsService.findForCourse — retourne insights existants triés par sévérité
- [x] PedagogicalInsightsService.dismiss — audit tracé, suppression, recréable à la prochaine génération
- [x] Filtrage STUDENT bloqué sur insights (ForbiddenException côté controller)
- [x] Rate limit génération insights : 3 req/heure
- [x] GET /courses/:courseId/analytics/questions
- [x] GET /professor/radar
- [x] GET /courses/:courseId/pedagogical-insights
- [x] POST /courses/:courseId/pedagogical-insights/generate
- [x] DELETE /courses/:courseId/pedagogical-insights/:insightId
- [x] Tests unitaires (14 cas : seuil anonymat, byClass masqué, total sous seuil, fire-and-forget, sévérité, ForbiddenException, dismiss)

### Phase 12 — Administration
- [x] AdminGuard — rechargement DB obligatoire (rôle + statut actif, pas confiance au JWT)
- [x] AdminService.listUsers — filtre role/status/search, select explicite (pas de passwordHash), audit
- [x] AdminService.getUser — détail + memberships, audit
- [x] AdminService.suspendUser — assertions (pas soi-même, pas un ADMIN), audit
- [x] AdminService.reactivateUser — idem
- [x] AdminService.listClasses — filtre status, _count membres/cours
- [x] AdminService.setClassStatus — protection transition (DELETED exige PENDING_DELETION avant), audit
- [x] AdminService.listAuditLogs — lecture seule, filtres action/acteur/cible/dates, pagination
- [x] AdminService.getGlobalStats — 7 compteurs en $transaction, audit
- [x] AdminService.createAdmin — hash Argon2id, email unique, plafond MAX_ADMINS (défaut 3), audit
- [x] AdminService.ensureAdminExists — délègue à createAdmin, idempotent (pour le seed)
- [x] AdminController — 10 routes /admin/*, double guard (JwtAuthGuard + AdminGuard)
- [x] POST /admin/users/admins — un ADMIN peut créer un autre ADMIN (dans le plafond)
- [x] GET /admin/admins — liste les comptes ADMIN existants (sans passwordHash)
- [x] AdminModule branché dans AppModule
- [x] prisma/seed-admin.ts — respecte MAX_ADMINS, Argon2id, validation mot de passe strict
- [x] POST /auth/register hardcode role: STUDENT (ADMIN impossible via inscription publique)
- [x] env.validation.ts — MAX_ADMINS: min(2).max(10).default(3)
- [x] Tests unitaires (22 cas : AdminGuard DB reload, suspend/réactivation, setClassStatus transitions, createAdmin plafond/email pris, ensureAdminExists idempotent, stats)

### Phase 13 — Classes inactives
- [x] Class.lastActivityAt (nullable, indexé) dans le schéma Prisma
- [x] LifecycleService.touchClass — met à jour lastActivityAt (fire-and-forget, WHERE status=ACTIVE)
- [x] Branché dans AiService.chat et DocumentsService.completeUpload
- [x] Transitions automatiques (4 étapes, toutes configurables par env) :
  - [x] ACTIVE → INACTIVE (LIFECYCLE_INACTIVE_AFTER_DAYS, défaut 90)
  - [x] INACTIVE → ARCHIVED (LIFECYCLE_ARCHIVE_AFTER_DAYS, défaut 180)
  - [x] ARCHIVED → PENDING_DELETION (LIFECYCLE_PENDING_DELETION_AFTER_DAYS, défaut 365)
  - [x] PENDING_DELETION → DELETED (LIFECYCLE_DELETED_AFTER_DAYS, défaut 30)
- [x] Suppression DELETED : anonymisation conversations (isAnonymous=true), deleteMany chunks, updateMany documents → DELETED, suppression en cascade dans l'ordre des contraintes FK, tout en $transaction atomique
- [x] Purge S3 asynchrone post-transaction (Promise.allSettled, échec S3 ne ramène pas la classe)
- [x] Notifications owner + co-owner à chaque transition (fire-and-forget, null filtré)
- [x] Audit systématique de chaque transition + DELETION_FAILED si transaction échoue
- [x] Résilience : erreur sur une classe n'interrompt pas les autres (Promise.allSettled)
- [x] LifecycleWorker (BullMQ cron) — jobId singleton, cron configurable (défaut 02:00)
- [x] Variables lifecycle ajoutées dans env.validation.ts et .env.example
- [x] Tests unitaires (15 cas : toutes les transitions, anonymisation RGPD, purge S3, DELETION_FAILED, résilience multi-classes, touchClass fire-and-forget)

### Phase 14 — Durcissement
- [x] Helmet fin (CSP, HSTS prod, X-Frame DENY, noSniff, COOP same-origin, CORP same-origin)
- [x] CORS strict (origins depuis env, jamais *, credentials, maxAge 24h, headers exposés limités)
- [x] Rate limiting par route (global 100/60s, /auth/login 5/60s, /chat 20/min, /insights 3/h)
- [x] requestId côté serveur, jamais depuis header client
- [x] AllExceptionsFilter — jamais de stack trace / SQL / chemin système en réponse
- [x] Logs pino avec redact (password, token, refreshToken, Authorization, cookie)
- [x] main.ts : payload limit 1 MB JSON (les fichiers passent par URL présignée S3)
- [x] TimeoutInterceptor global (30s configurable via REQUEST_TIMEOUT_MS)
- [x] StrictUuidPipe — rejet UUID malformés sans fuite du nom de paramètre
- [x] Tests IDOR/BOLA : test/security/idor.security.spec.ts (9 cas)
- [x] Tests RBAC : test/security/rbac.security.spec.ts (14 cas)
- [x] Tests concurrence : test/security/concurrency.security.spec.ts (4 cas)
- [x] Tests upload sécurité : test/security/upload.security.spec.ts (22 cas — MIME, magic bytes, path traversal)
- [x] Tests StrictUuidPipe : strict-uuid.pipe.spec.ts (12 cas)
- [x] test/jest-security.json — suite dédiée, lancée par `npm run test:security`
- [x] npm run audit:deps (niveau HIGH) + npm run audit:full
- [x] docs/security-checklist.md — checklist complète pré-production (13 sections)

### Phase 15 — Production
- [x] Dockerfile multi-stage (deps → build → production, non-root, HEALTHCHECK intégré)
- [x] docker-compose.prod.yml (api + postgres pgvector + redis password + backup cron)
- [x] Postgres non exposé sur Internet, Redis non exposé sur Internet
- [x] scripts/db-init.sql — user applicatif aux privilèges minimaux (pas le superuser)
- [x] scripts/backup.sh — dump chiffré AES-256-CBC, rétention 7 jours, pipeline sans fichier clair sur disque
- [x] scripts/restore.sh — déchiffrement + pg_restore, confirmation manuelle obligatoire
- [x] .github/workflows/ci.yml — lint + typecheck + tests unitaires + tests sécurité + tests e2e (postgres+redis réels) + audit dépendances + build Docker + push ghcr.io (main uniquement)
- [x] .github/workflows/deploy.yml — déploiement manuel uniquement (workflow_dispatch, confirmation "deploy", GitHub Environment = approbation humaine)
- [x] Migrations pgvector appliquées en CI (phase8_pgvector_embeddings.sql + indexes.sql)
- [x] Déploiement zero-downtime : migrations avant redémarrage de l'API
- [x] Health check DB + Redis + mémoire (GET /api/v1/health, exclu du rate limiting)
- [x] RedisHealthIndicator — connexion à la demande, fermée après le ping
- [x] Swagger / OpenAPI — exposé uniquement hors production (/api/v1/docs)
- [x] seed-admin.ts — idempotent, respecte MAX_ADMINS, Argon2id, validation stricte
- [x] @nestjs/swagger + ioredis ajoutés au package.json

---

## FONCTIONNALITÉ EN COURS

Aucune.
