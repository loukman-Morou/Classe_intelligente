# Migration manuelle — Phase 8 : pgvector + embeddings

Prisma ne supporte pas nativement les types pgvector ni les index HNSW.
Ces éléments s'ajoutent via une migration SQL manuelle APRÈS la migration
initiale Prisma générée en Phase 1.

## Ordre d'application

```bash
# 1. Migration initiale (Phase 1, si pas encore faite)
npx prisma migrate dev --name init_schema

# 2. Appliquer la migration pgvector manuellement
psql $DATABASE_URL < prisma/migrations/manual/phase8_pgvector_embeddings.sql

# 3. Générer le client Prisma (la colonne embedding reste Unsupported("vector") dans schema.prisma)
npx prisma generate
```

## Pourquoi SQL manuel et non Prisma ?

- L'extension `vector` (pgvector) doit être installée par un superuser PostgreSQL
  (`CREATE EXTENSION IF NOT EXISTS vector`).
- Le type `vector(1536)` est non supporté nativement par Prisma — il est déclaré
  `Unsupported("vector(1536)")` dans schema.prisma et traité via `$queryRaw` dans le code.
- Les index HNSW/ivfflat sur colonnes vector doivent être créés après l'insertion
  de données, pas à la création de la table — ils sont donc dans une migration
  séparée (`phase8_pgvector_indexes.sql`).

## Prérequis production

- PostgreSQL 15+ avec pgvector >= 0.5.0 installé dans l'image
  (l'image `pgvector/pgvector:pg16` du docker-compose.yml l'inclut).
- Le compte applicatif doit avoir `CREATE` sur le schéma pour créer les index.
- L'extension est installée par le superuser une seule fois par base.
