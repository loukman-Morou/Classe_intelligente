# CAHIER DE SÉCURITÉ — CLASSE INTELLIGENTE

**Version 1.0 — Règles obligatoires**

Ce document définit les règles de sécurité que le backend, le frontend, la base de données et l'infrastructure doivent respecter. Toute fonctionnalité nouvelle doit respecter ces règles avant d'être intégrée.

---

## 1. PRINCIPES FONDAMENTAUX

* La sécurité doit être appliquée **côté serveur**. Le frontend ne doit jamais être considéré comme fiable.
* Le principe du **moindre privilège** doit être appliqué partout.
* Chaque utilisateur ne doit accéder qu'aux ressources auxquelles il a explicitement droit.
* Les données d'une classe ne doivent jamais être accessibles depuis une autre classe.
* Les données d'un cours ne doivent jamais être accessibles à un professeur qui n'est pas autorisé sur ce cours.
* Aucun secret, mot de passe, clé API ou token privé ne doit être présent dans le frontend ou dans Git.
* Les erreurs retournées au client ne doivent jamais révéler d'informations internes.
* Toute opération sensible doit pouvoir être auditée.

---

## 2. AUTHENTIFICATION

* Utiliser une authentification moderne basée sur **access token + refresh token**.
* Les mots de passe doivent être hachés avec **Argon2id**.
* Ne jamais stocker de mot de passe en clair.
* Ne jamais utiliser MD5, SHA-1 ou SHA-256 seul pour stocker les mots de passe.
* Imposer une politique de mot de passe raisonnable.
* Mettre en place une limitation des tentatives de connexion.
* Ajouter un mécanisme de protection contre le credential stuffing et le brute force.
* Les access tokens doivent avoir une durée de vie courte.
* Les refresh tokens doivent être rotatifs et révocables.
* Ne jamais mettre de token sensible dans une URL.
* Les tokens doivent être générés avec un générateur cryptographiquement sécurisé.
* Prévoir la révocation des sessions.
* Prévoir la possibilité de déconnecter toutes les sessions d'un utilisateur.
* Si des cookies sont utilisés : `HttpOnly`, `Secure` et politique `SameSite` appropriée.

---

## 3. AUTORISATION ET RBAC

Les rôles minimum sont :

```text
RESPONSIBLE
PROFESSOR
STUDENT
```

Le backend doit vérifier les permissions pour **chaque requête sensible**.

Un professeur autorisé sur `Classe A → Réseaux` ne doit jamais pouvoir accéder à
`Classe A → Mathématiques` ni `Classe B → Réseaux`, même en modifiant manuellement
l'URL ou l'ID envoyé au backend.

Ne jamais considérer un `classId`, `courseId` ou `userId` fourni par le frontend
comme fiable.

---

## 4. PROTECTION IDOR / BOLA

Toutes les ressources doivent être protégées contre les accès directs par
identifiant. Le backend doit effectuer les contrôles d'autorisation **avant** de
retourner la ressource. S'applique notamment à : classes, courses, documents,
conversations, quizzes, invitations, statistics, analytics, users.

---

## 5. INVITATIONS PROFESSEURS

Les invitations doivent : utiliser des tokens aléatoires cryptographiquement
sécurisés, être uniques, avoir une durée d'expiration, pouvoir être révoquées, avoir
un nombre d'utilisations contrôlé, être associées à un seul cours, ne jamais donner
accès à toute la classe, ne jamais contenir d'informations sensibles dans le token,
être invalidées après utilisation si à usage unique.

---

## 6. BASE DE DONNÉES

* PostgreSQL doit être inaccessible directement depuis Internet.
* Seul le backend doit pouvoir communiquer avec la base.
* Utiliser un utilisateur PostgreSQL avec les permissions minimales nécessaires ;
  ne jamais utiliser le compte administrateur PostgreSQL depuis l'application.
* Toutes les requêtes doivent utiliser Prisma/ORM ou des requêtes paramétrées —
  jamais de concaténation de données utilisateur dans du SQL.
* Activer les contraintes de clés étrangères, utiliser des transactions pour les
  opérations critiques, ajouter des index sur les champs fréquemment recherchés.
* Prévoir des sauvegardes automatiques, tester régulièrement leur restauration,
  chiffrer les sauvegardes contenant des données sensibles.
* Ne jamais stocker de secrets directement dans `schema.prisma`.

---

## 7. ISOLATION DES DONNÉES

Isolation stricte entre classes : aucune requête ne doit pouvoir mélanger les
données de deux classes sans autorisation explicite. Pour le RAG, la recherche
vectorielle doit obligatoirement être filtrée par `classId`, `courseId` et les
permissions utilisateur.

---

## 8. SÉCURITÉ DU RAG / IA

L'IA n'est jamais une source d'autorisation : le backend contrôle les permissions
**avant** la recherche documentaire.

```text
Question → Authentification → Autorisation → Identification du cours →
Recherche uniquement dans le cours autorisé → Récupération des documents → LLM → Réponse
```

Protections à mettre en place : prompt injection, extraction de données d'autres
utilisateurs, contournement des restrictions, fuite de contenu entre classes,
exposition de prompts système, exposition de clés API. Le modèle ne décide jamais
qui peut voir un document — c'est toujours le backend.

---

## 9. QUESTIONS ANONYMES

Mode anonyme : identité non affichée au professeur, statistiques agrégées, pas de
ré-identification facile via les questions individuelles, éviter les statistiques
sur des groupes trop petits. Les données techniques nécessaires à la sécurité
peuvent être conservées séparément avec un accès fortement restreint — l'anonymat
côté utilisateur n'empêche donc pas les mécanismes internes de sécurité et d'audit.

---

## 10. UPLOAD DE FICHIERS

Tous les fichiers sont non fiables par défaut : limiter la taille et les
extensions, vérifier réellement le type MIME et la signature/magic bytes, renommer
les fichiers côté serveur, ne jamais utiliser le nom fourni par l'utilisateur comme
chemin système, empêcher le path traversal (ex. `../../../../etc/passwd` doit être
rejeté), stocker hors du dossier public, analyser si nécessaire, ne jamais exécuter
un fichier uploadé, appliquer des quotas par utilisateur/classe.

---

## 11. STOCKAGE

Stockage privé (S3 / Cloudflare R2 / équivalent), jamais publiquement accessible.
Le frontend reçoit des URLs temporaires/signées pour télécharger un fichier. Ne
jamais exposer `AWS_ACCESS_KEY` / `AWS_SECRET_KEY` / S3 credentials au frontend.

---

## 12. API

HTTPS en production, préfixe `/api/v1`, validation de toutes les entrées, rate
limiting, quotas, vérification des permissions, réponses d'erreur standardisées,
jamais de données inutiles, jamais de stack trace/SQL/chemin interne exposé.
Prévoir : rate limiting, request validation, CORS strict, security headers, request
IDs, timeouts, payload limits.

---

## 13. PROTECTION CONTRE LES ATTAQUES WEB

Protéger au minimum contre : SQL Injection, XSS, CSRF, IDOR/BOLA, Brute Force,
Credential Stuffing, Path Traversal, SSRF, Command Injection, File Upload Attacks,
Prompt Injection, Data Leakage, Enumeration Attacks, Rate Limit Abuse. Utiliser les
protections natives de NestJS et de l'infrastructure plutôt que de réinventer les
mécanismes de sécurité.

---

## 14. CORS

Ne jamais utiliser `Access-Control-Allow-Origin: *` en production. Autoriser
uniquement les domaines officiels de l'application.

---

## 15. SECRETS ET VARIABLES D'ENVIRONNEMENT

Secrets fournis uniquement via variables d'environnement ou gestionnaire de
secrets :

```env
DATABASE_URL=
JWT_SECRET=
JWT_REFRESH_SECRET=
OPENAI_API_KEY=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
```

Ne jamais committer `.env`, `.env.production`, clés privées, API keys, mots de
passe DB, secrets JWT. Le repository ne contient que `.env.example` avec des
valeurs fictives.

---

## 16. LOGS

Ne jamais logger : password, accessToken, refreshToken, API key, session cookie,
documents privés, questions privées complètes, données personnelles inutiles.
Contenu minimal utile : timestamp, requestId, endpoint, statusCode, userId
pseudonymisé si nécessaire, duration, errorCode.

---

## 17. AUDIT

Opérations à enregistrer : connexion, déconnexion, échec de connexion, création de
classe, suppression de classe, invitation professeur, révocation professeur, upload
document, suppression document, modification permissions, accès administrateur. Les
logs d'audit doivent être protégés contre leur modification par les utilisateurs
ordinaires.

---

## 18. RGPD / DONNÉES PERSONNELLES

Collecter uniquement le nécessaire. Prévoir : suppression du compte, export des
données, suppression des données, gestion du consentement lorsque nécessaire,
politique de conservation, politique de confidentialité. Documenter quelles données
sont collectées, pourquoi, combien de temps, qui peut les consulter, quand elles
sont supprimées. Les données des étudiants ne doivent pas être utilisées pour
entraîner un modèle externe sans base légale et information/consentement appropriés.

---

## 19. CONSERVATION DES CLASSES INACTIVES

```text
ACTIVE → INACTIVE → ARCHIVED → PENDING_DELETION → DELETED
```

Suppression précédée d'une période de rétention configurable, et accompagnée de la
suppression ou anonymisation des données associées selon la politique de
conservation.

---

## 20. CHIFFREMENT

HTTPS/TLS pour les communications, encryption at rest pour le stockage et les
sauvegardes. Les mots de passe sont **hachés**, jamais chiffrés. Les secrets
nécessitant une récupération sont protégés par un gestionnaire de secrets.

---

## 21. FRONTEND

Ne jamais contenir `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `S3_SECRET`,
identifiants admin. Toute donnée reçue est considérée comme potentiellement
manipulée. Une vérification de rôle côté frontend (`if (user.role === "PROFESSOR")`)
peut améliorer l'UX mais **l'autorisation réelle est toujours vérifiée côté
backend**.

---

## 22. INFRASTRUCTURE

```text
Internet → HTTPS/Reverse Proxy → API → PostgreSQL privé → Storage privé
```

Redis/queues également privés. Ne jamais exposer PostgreSQL, Redis, Storage,
interfaces admin directement sur Internet.

---

## 23. TESTS DE SÉCURITÉ

Avant chaque version importante : tests unitaires, intégration, autorisation, API,
upload, RAG, rate limiting, permissions. Cas à tester explicitement (tous doivent
être refusés) : étudiant A → données étudiant B, professeur A → cours professeur B,
professeur → autre classe, utilisateur non authentifié → API privée, token expiré →
API, invitation expirée → acceptation, document supprimé → téléchargement, ID
modifié manuellement → accès refusé.

---

## 24. DÉPENDANCES

Utiliser uniquement les dépendances nécessaires, les maintenir à jour, exécuter
régulièrement `npm audit`, vérifier les vulnérabilités critiques avant déploiement,
ne pas installer une bibliothèque pour sa seule popularité, verrouiller les
versions via le lockfile.

---

## 25. CI/CD

Chaque Pull Request exécute idéalement : lint, type checking, unit tests,
integration tests, build, dependency security scan. Aucun code fusionné si les
tests critiques échouent.

---

## 26. SAUVEGARDES

```text
Backup automatique → Stockage séparé → Chiffrement → Rétention → Tests de restauration réguliers
```

Une sauvegarde jamais restaurée/testée n'est pas considérée comme fiable.

---

## 27. RÈGLE ABSOLUE POUR LE PROJET

Aucune fonctionnalité n'est terminée simplement parce qu'elle fonctionne. Elle doit
respecter : Fonctionnalité + Authentification + Autorisation + Validation +
Isolation des données + Protection contre l'abus + Logs/audit si nécessaire + Tests
de sécurité → VALIDÉE.

**Objectif final :**

```text
ZERO confiance envers le frontend
ZERO accès implicite
ZERO secret dans Git
ZERO document privé publiquement accessible
ZERO accès inter-classe
ZERO accès professeur hors de son cours
ZERO décision d'autorisation confiée à l'IA
ZERO donnée sensible inutile dans les logs
```

---

## ANNEXE — Notes d'implémentation (Phase 0/1, backend)

Cette annexe documente comment les règles ci-dessus sont concrètement traduites
dans le code déjà livré ; elle n'ajoute aucune règle nouvelle.

* **§1/§3 (pipeline d'autorisation)** : chaque route protégée suit
  `AUTHENTIFICATION → RESSOURCE (rechargée depuis la DB) → CONTEXTE CLASSE/COURS →
  AUTORISATION → LOGIQUE MÉTIER → RÉPONSE` — voir `backend-architecture.md` §4.
* **§6 (contraintes DB / transactions)** : la règle de multiplicité des
  responsables (nombre exact encore à confirmer, voir PROGRESS.md) sera protégée à
  la fois par une transaction applicative (verrouillage `SELECT ... FOR UPDATE` en
  Phase 3) et par un trigger Postgres de défense en profondeur — voir
  `docs/database.md` §Concurrence.
* **§10/§11 (upload)** : `storageKey` généré côté serveur, `originalFilename`
  conservé uniquement pour l'affichage — voir modèle `Document` dans
  `prisma/schema.prisma`.
* **§12 (erreurs standardisées)** : implémenté par `AllExceptionsFilter`
  (`src/common/filters/all-exceptions.filter.ts`), format
  `{"error": {"code","message","requestId"}}` conforme à `docs/api-contract.md` §1.
* **§16 (logs)** : `requestId` généré côté serveur (jamais depuis un header
  client), logs pino avec `redact` sur password/token/authorization/cookie en plus
  de la discipline de ne jamais les logger — voir `src/app.module.ts` et
  `src/common/interceptors/logging.interceptor.ts`.
* **§14 (CORS)** : origines lues depuis `CORS_ALLOWED_ORIGINS`, jamais de valeur
  par défaut ouverte (le démarrage échoue si la variable est absente) — voir
  `src/config/env.validation.ts`.
