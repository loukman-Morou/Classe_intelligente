# AI CONTEXT

## Projet
Classe Intelligente — backend API.

## Stack
NestJS + TypeScript + PostgreSQL + Prisma + Redis.

## Architecture
Monolithe modulaire.

## Rôles
ADMIN
RESPONSIBLE
PROFESSOR
STUDENT

## Règle importante
Maximum 2 responsables par classe.

## Professeurs
Un professeur n'accède qu'aux cours qui lui sont attribués.

## Sécurité
Le frontend n'est jamais une source de confiance.
Toutes les permissions sont vérifiées côté backend.

## IA
Le RAG doit toujours être filtré par classId/courseId.

## Développement
Une fonctionnalité à la fois.
Tester avant de continuer.
Ne jamais modifier une fonctionnalité existante sans nécessité.

## Documentation
Spécification produit (vision, rôles, MVP) → docs/cahier-des-charges.md
API → docs/api-contract.md
Sécurité → docs/security.md
Architecture → backend-architecture.md (voir aussi docs/architecture.md, qui pointe vers ce fichier)
Base de données → docs/database.md

## Responsable(s) de classe
Une classe a un responsable principal obligatoire (`Class.ownerId`) et un
co-responsable optionnel (`Class.coOwnerId`, 0 ou 1). Voir docs/database.md.

> Note : le prompt maître (section 1) désigne `backend-architecture.md` (racine) comme lecture
> obligatoire avant chaque tâche. `docs/architecture.md` est conservé comme alias pour ne pas
> casser cette référence, mais le contenu de référence vit dans `backend-architecture.md`.
