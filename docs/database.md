# DATABASE — Classe Intelligente

PostgreSQL via Prisma. Jamais exposé directement à Internet. Compte applicatif à
privilèges minimaux (pas de rôle superuser côté connexion de l'API — voir
`docs/security.md` §6 ; à mettre en place explicitement en Phase 15/Production pour
l'environnement Docker de dev, qui utilise aujourd'hui un unique utilisateur simplifié).

Cette page couvre le schéma tel qu'implémenté en Phase 1. Le schéma source de vérité
est `prisma/schema.prisma` — cette page en est la version lisible/commentée.

## Responsable(s) de classe — décision retenue

Une classe a **un responsable principal obligatoire** (`Class.ownerId`) et,
optionnellement, **un seul co-responsable** (`Class.coOwnerId`, nullable). Pas de
modèle "1 à 2 responsables via un flag booléen sur ClassMember + trigger" : deux
colonnes à une seule valeur suffisent, et "au plus 1 co-responsable" est garanti par
construction (une colonne ne peut référencer qu'un seul utilisateur), sans besoin de
trigger Postgres dédié.

## Entités principales (Phase 1)

- **User** — identité globale : `email`, `firstName`, `lastName`, `role` ∈ {ADMIN,
  STUDENT, PROFESSOR}, mot de passe (hash Argon2id uniquement), `status`
  (actif/suspendu).
- **Class** — une classe : `name`, `academicYear`, `description`, `ownerId`
  (obligatoire), `coOwnerId` (optionnel). Statut de cycle de vie : `ACTIVE →
  INACTIVE → ARCHIVED → PENDING_DELETION → DELETED` (Phase 13).
- **ClassMember** — jonction `User ↔ Class` : atteste qu'un utilisateur appartient
  à la classe (élèves, et par construction applicative le owner/co-owner aussi,
  pour apparaître dans la liste des membres et voir les cours). Ne porte plus de
  notion de rôle "responsable" — celle-ci vit uniquement sur `Class`.
- **Course** — rattaché à une `Class` : `name`, `description`.
- **CourseProfessor** — jonction `User(role=PROFESSOR) ↔ Course`. Seule source
  d'autorisation d'accès d'un professeur à un cours : jamais d'accès implicite via
  l'appartenance à la classe.
- **Invitation** (table `course_invitations`) — invitation professeur : seul le hash
  du token est stocké (`tokenHash`, unique — jamais le token brut, pour qu'une fuite
  DB ne permette pas de rejouer une invitation), `courseId` associé, expiration,
  statut (pending/accepted/revoked/expired), usage unique.
- **Document** — métadonnées d'un fichier uploadé : `courseId`, `originalFilename`
  (affichage uniquement), `storageKey` généré côté serveur (jamais le nom original
  utilisé comme chemin), statut du pipeline (`UPLOADED → PROCESSING → READY →
  FAILED`, plus `DELETED` pour la suppression logique).
- **DocumentChunk** — segment de texte, référence `documentId`, dénormalise
  `courseId`/`classId` pour permettre un filtrage direct côté requête vectorielle
  sans jointure supplémentaire critique pour la sécurité. Colonne `embedding` +
  extension pgvector + index ivfflat/hnsw : ajoutés par une migration dédiée en
  Phase 8, une fois le modèle d'embeddings (et sa dimension) choisi.
- **Conversation** — fil de discussion IA : `courseId`, `userId` (**toujours**
  renseigné, y compris en mode anonyme — voir `docs/security.md` §9),
  `isAnonymous: boolean`.
- **Message** — message dans une conversation (rôle user/assistant, contenu,
  `sources` citées en JSON).
- **Quiz** / **QuizQuestion** — générés à partir d'un cours.
- **QuestionTopic** — thème identifié pour un cours (ex. « Subnetting », « CIDR »),
  alimente le radar pédagogique (Phase 11).
- **QuestionAnalytics** — comptage agrégé de questions par `QuestionTopic`/`Course`
  (radar pédagogique, §20 du cahier des charges).
- **PedagogicalInsight** — difficulté détectée dérivée des analytics : `severity`,
  `recommendation`, liée à un `QuestionTopic`/`Course` (Phase 11).
- **AuditLog** — action sensible, acteur (`SetNull` si le compte est supprimé —
  l'audit doit survivre), cible, horodatage, métadonnées non sensibles.
- **Notification** — notification interne utilisateur.

Non modélisé en Phase 1 (volontairement) :
- **RefreshToken/Session** : couplé à la logique de rotation/révocation de la
  Phase 2 (Authentification), ajouté avec elle.
- **Colonne `embedding` sur DocumentChunk** : voir ci-dessus, Phase 8.

## Conventions

- Clés primaires : `uuid()` natif Postgres (`@db.Uuid`), jamais d'ID séquentiel
  exposé publiquement (limite l'énumération).
- Toute relation classe/cours porte une contrainte `ON DELETE` explicite et
  volontairement choisie plutôt qu'un `Cascade` par défaut partout :
  - `Restrict` sur les relations parent→enfant du domaine (`Class→Course`,
    `Course→Document/Conversation/Quiz/Invitation`, `ClassMember→Class`,
    `CourseProfessor→Course`) : empêche une suppression implicite en chaîne ; la
    purge contrôlée (Phase 13) doit gérer explicitement l'ordre de suppression.
  - `Restrict` sur `Class.ownerId` : supprimer un compte propriétaire exige de
    transférer la propriété d'abord (flux RGPD explicite, Phase 13/18), jamais une
    suppression implicite qui laisserait une classe sans responsable.
  - `SetNull` sur `Class.coOwnerId` : la suppression du compte co-responsable
    libère simplement le créneau — la classe garde son `owner`, rien de dangereux
    à laisser cette référence devenir NULL automatiquement.
  - `Cascade` uniquement pour les lignes purement dépendantes qui n'ont aucun sens
    sans leur parent (`DocumentChunk→Document`, `Message→Conversation`,
    `QuizQuestion→Quiz`) ou pour la suppression d'un compte `User` sur ses propres
    rattachements (`ClassMember.userId`, `CourseProfessor.userId`,
    `Notification.userId`).
  - `SetNull` pour les autres références d'acteur/audit qui doivent survivre à la
    suppression du compte référencé (`Document.uploadedByUserId`,
    `Invitation.invitedByUserId`/`acceptedByUserId`, `AuditLog.actorUserId`).
  - `Restrict` volontaire sur `Conversation.userId` : la suppression d'un
    utilisateur ayant des conversations doit être un choix explicite du flux RGPD
    (Phase 13/18), jamais un `SetNull` silencieux qui rendrait `userId` NULL sans
    distinction avec `isAnonymous`.
- Index sur toutes les clés étrangères utilisées dans les filtres d'autorisation
  (`classId`, `courseId`, `userId`, `ownerId`, `coOwnerId`) — chemin chaud de
  chaque requête protégée.
- Migrations Prisma versionnées, générées via `npx prisma migrate dev` sur une
  machine avec accès réseau (le moteur Prisma n'est pas exécutable dans le
  sandbox utilisé pour écrire ce schéma) — jamais de modification manuelle du
  schéma en production.

## Concurrence — attribution du co-responsable

"Au plus 1 co-responsable" est garanti par construction (colonne à valeur unique),
donc aucun trigger n'est nécessaire pour cette limite. Le seul risque de
concurrence restant est que deux requêtes tentent de pourvoir le créneau en même
temps : à traiter en Phase 3 par une mise à jour conditionnelle atomique, par
exemple :

```sql
UPDATE classes
SET co_owner_id = $1
WHERE id = $2 AND co_owner_id IS NULL;
-- 0 ligne affectée => le créneau était déjà pris entre-temps => 409 Conflict
```

(équivalent via `prisma.class.updateMany({ where: { id, coOwnerId: null }, data: { coOwnerId } })`
et vérification de `count === 1`), plutôt qu'un `SELECT` suivi d'un `UPDATE` non
atomique.
