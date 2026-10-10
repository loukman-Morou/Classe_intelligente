# BACKEND ARCHITECTURE — Classe Intelligente

> Document de référence obligatoire (lu avant `PROGRESS.md` selon l'ordre de lecture,
> voir `AI_CONTEXT.md`). Ne pas dupliquer son contenu dans les réponses de travail —
> le citer par section si besoin.

## 1. Style d'architecture

Monolithe modulaire NestJS. Pas de microservices.

Flux de couches, dans cet ordre, sans exception :

```
Controller → Service → Repository/Prisma → PostgreSQL
```

- Les controllers sont fins : validation d'entrée (DTO) + délégation. Aucune logique métier.
- Les services portent toute la logique métier et toutes les vérifications d'autorisation
  fines (au-delà du rôle global).
- L'accès aux données passe par Prisma (pas de SQL brut hors cas justifié et isolé).

## 2. Rôles

Rôles globaux (`User.role`) : `ADMIN`, `STUDENT`, `PROFESSOR`.

`RESPONSIBLE` n'est **pas** un rôle global : c'est porté directement par `Class`
(`Class.ownerId` obligatoire, `Class.coOwnerId` optionnel — voir
`docs/database.md`). Un utilisateur `STUDENT` peut être owner/co-owner d'une classe
et simple membre d'une autre.

Règles :
- Une classe a toujours un `ownerId`.
- `coOwnerId` est optionnel (0 ou 1) ; l'attribution de ce créneau doit être une
  mise à jour conditionnelle atomique (pas de `SELECT` puis `UPDATE` séparés) —
  voir `docs/database.md` §Concurrence.

## 3. Structure des modules

```
src/
├── auth/                 # login, register, refresh, logout, /auth/me
├── users/                # profil utilisateur, suspension (admin)
├── classes/              # classes, membership, promotion/rétrogradation responsable
├── class-members/        # jonction User↔Class, rôle local (member/responsible)
├── courses/               # cours, rattachés à une classe
├── course-professors/    # jonction Professor↔Course (accès scoped au cours)
├── invitations/           # invitations professeur, à usage unique, expirables
├── documents/             # métadonnées documents, cycle de vie
├── storage/               # abstraction stockage privé (S3-compatible), URLs signées
├── processing/            # orchestration pipeline OCR→chunking→embeddings (BullMQ)
├── ocr/                   # extraction de texte (PDF/scan)
├── ai/                    # appel LLM, garde-fous prompt/réponse
├── rag/                   # recherche vectorielle (pgvector), filtrage classId/courseId
├── conversations/         # conversations + messages (y compris mode anonyme)
├── quizzes/                # QCM, questions ouvertes, flashcards générés
├── analytics/             # QuestionTopic/QuestionAnalytics — comptage par thème (radar - data)
├── pedagogical-insights/  # agrégation/exposition radar pédagogique (vue professeur)
├── notifications/         # notifications internes (archivage, suppression, invitations)
├── admin/                 # endpoints ADMIN (gestion utilisateurs/classes/audit)
├── audit/                  # écriture/lecture des logs d'audit
├── common/                # filtres, interceptors, guards, decorators, pipes partagés
└── config/                # chargement + validation de la configuration (env)
```

Chaque module suit systématiquement : `*.module.ts`, `*.controller.ts`, `*.service.ts`,
`dto/`, et ses propres `guards`/`decorators` s'il en a besoin (ex: `RequireCourseAccess`).

## 4. Requête protégée — pipeline obligatoire

Pour **toute** route qui touche une ressource scoped classe/cours :

```
REQUEST
 → AUTHENTIFICATION (JwtAuthGuard : token valide, non révoqué)
 → RESSOURCE (chargement de la ressource visée depuis la DB, jamais depuis le payload client)
 → CONTEXTE CLASSE/COURS (dérivation classId/courseId à partir de la ressource chargée)
 → AUTORISATION (guard dédié : le user a-t-il le droit sur CE classId/courseId précis ?)
 → LOGIQUE MÉTIER (service)
 → RÉPONSE
```

Principe non négociable : `userId`, `role`, `classId`, `courseId`, `permissions` envoyés par
le client ne sont **jamais** utilisés tels quels pour une décision d'autorisation. Le backend
recharge et revérifie systématiquement depuis la base.

## 5. API

Préfixe global : `/api/v1`. REST. Swagger/OpenAPI générée = contrat officiel exposé.
Liste des routes de référence : `docs/api-contract.md`.

## 6. Base de données

Entités et conventions : `docs/database.md`.

## 7. Sécurité, RAG, RGPD, logs

Détail complet : `docs/security.md`. Ce fichier `backend-architecture.md` ne répète pas
les règles de sécurité, uniquement leur point d'ancrage dans l'architecture (section 4).

## 8. Phasage

Le développement suit strictement l'ordre des phases listées dans `PROGRESS.md`
(Phase 0 → Phase 15). Une fonctionnalité = une tâche = un cycle complet
(plan → code → tests → sécurité → mise à jour PROGRESS.md → arrêt/validation).
