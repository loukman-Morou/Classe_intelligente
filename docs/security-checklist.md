# SECURITY CHECKLIST — Phase 14

Document de validation avant production.
Cocher chaque point après vérification manuelle ou test automatisé.

---

## 1. Headers HTTP (Helmet)

- [x] `Content-Security-Policy` configurée (defaultSrc 'self', objectSrc 'none', frameSrc 'none')
- [x] `Strict-Transport-Security` activé en production (maxAge 1 an, includeSubDomains)
- [x] `X-Frame-Options: DENY`
- [x] `X-Content-Type-Options: nosniff`
- [x] `Referrer-Policy: strict-origin-when-cross-origin`
- [x] `Cross-Origin-Opener-Policy: same-origin`
- [x] `Cross-Origin-Resource-Policy: same-origin`
- [x] `X-Powered-By` masqué

## 2. CORS

- [x] Pas de wildcard `*` en production
- [x] Origines autorisées uniquement depuis `CORS_ALLOWED_ORIGINS` (env)
- [x] Headers exposés limités (`X-Request-Id` uniquement)
- [x] Credentials autorisés (nécessaire pour les cookies `HttpOnly`)
- [x] Preflight mis en cache 24h (`maxAge: 86400`)

## 3. Authentification

- [x] Argon2id (memoryCost 64 MiB, timeCost 3, parallelism 4)
- [x] Jamais de MD5 / SHA-1 / SHA-256 pour les mots de passe
- [x] JWT access token court (15 min)
- [x] Refresh token haché en DB (SHA-256) — jamais le brut
- [x] Rotation des refresh tokens (ancien invalidé à chaque usage)
- [x] Révocation globale possible (logout-all)
- [x] `/auth/me` recharge le user depuis la DB
- [x] `POST /auth/register` force `role: STUDENT` (ADMIN impossible publiquement)
- [x] Rate limiting strict sur `/auth/login` (5 req/60s)

## 4. Autorisation (IDOR / BOLA / RBAC)

- [x] `ClassMemberGuard` — rechargement classId depuis DB (pas depuis payload)
- [x] `ClassOwnerGuard` — rechargement depuis DB
- [x] `CourseAccessGuard` — rechargement courseId + classId depuis DB, résolution rôle
- [x] `AdminGuard` — rechargement rôle + statut depuis DB (pas de confiance au JWT)
- [x] `ProfessorRoleGuard` — rôle global vérifié
- [x] `ProfessorCourseOwnerGuard` — ownership du cours professeur
- [x] Tests IDOR : `test/security/idor.security.spec.ts`
- [x] Tests RBAC : `test/security/rbac.security.spec.ts`

## 5. Upload de fichiers

- [x] MIME allowlist (PDF, JPEG, PNG uniquement)
- [x] Magic bytes vérifiés (PDF `%PDF`, JPEG `FFD8FF`, PNG `89504E47`)
- [x] Taille maximale configurable (`UPLOAD_MAX_FILE_SIZE_BYTES`)
- [x] Quota par cours (`UPLOAD_MAX_QUOTA_PER_COURSE_BYTES`)
- [x] `storageKey` généré par le serveur (UUID) — jamais depuis le nom client
- [x] Protection path traversal par construction (`courses/<courseId>/<uuid>`)
- [x] Stockage privé (jamais d'accès public direct)
- [x] URLs signées à durée de vie courte (15 min)
- [x] Tests upload : `test/security/upload.security.spec.ts`

## 6. RAG / IA

- [x] Filtrage SQL `WHERE courseId AND classId` (pas en post-traitement)
- [x] L'IA ne décide jamais des permissions
- [x] Séparation SYSTEM/USER/DOCUMENT dans le prompt
- [x] Sanitisation XML des chunks (balises `<>` échappées)
- [x] Prompt système hardcodé en TypeScript (pas depuis env ou DB)
- [x] Rate limiting sur `/chat` (20 req/min)

## 7. Concurrence

- [x] Attribution co-owner : `UPDATE ... WHERE coOwnerId IS NULL` (atomique)
- [x] Tests concurrence : `test/security/concurrency.security.spec.ts`
- [x] Transactions Prisma sur les opérations critiques

## 8. Gestion des erreurs

- [x] `AllExceptionsFilter` — format standard `{error: {code, message, requestId}}`
- [x] Jamais de stack trace en réponse
- [x] Jamais de SQL/Prisma en réponse
- [x] Jamais de chemin système en réponse
- [x] `requestId` généré côté serveur (pas depuis un header client)

## 9. Logs

- [x] Redact pino : password, token, refreshToken, accessToken, Authorization, cookie
- [x] Jamais de content privé dans les logs
- [x] Logs structurés (timestamp, requestId, endpoint, status, duration)
- [x] `AuditLog` pour toutes les actions sensibles

## 10. Administration

- [x] ADMIN créé uniquement via `seed-admin.ts` (pas via `/auth/register`)
- [x] Plafond `MAX_ADMINS` configurable (défaut 3, min 2)
- [x] Toute action ADMIN auditée
- [x] ADMIN ne peut pas suspendre un autre ADMIN
- [x] ADMIN ne peut pas se suspendre lui-même

## 11. Cycle de vie classes (RGPD)

- [x] Jamais de suppression directe ACTIVE → DELETED
- [x] Anonymisation conversations avant DELETED
- [x] Suppression physique S3 asynchrone (fire-and-forget)
- [x] Audit `DELETION_FAILED` si transaction échoue

## 12. Dependency audit

```bash
npm run audit:deps  # échoue si vulnérabilité HIGH ou CRITICAL
npm run audit:full  # rapport complet
```

- [ ] Aucune vulnérabilité HIGH/CRITICAL dans les dépendances (vérifier avant chaque déploiement)
- [ ] Lockfile (`package-lock.json`) commité et à jour

## 13. Points à vérifier manuellement avant production

- [ ] Variables `.env.production` dans un gestionnaire de secrets (pas dans Git)
- [ ] `DATABASE_URL` avec un user Postgres aux privilèges minimaux
- [ ] Redis non exposé sur Internet
- [ ] PostgreSQL non exposé sur Internet
- [ ] Storage S3/R2 privé (pas de bucket public)
- [ ] HTTPS/TLS configuré sur le reverse proxy
- [ ] Rate limiting par IP testé en charge
- [ ] Rotation des clés JWT planifiée
