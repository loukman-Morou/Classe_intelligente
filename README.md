# Classe Intelligente — Backend

Backend NestJS de la plateforme collaborative de classe « Classe Intelligente ».

## État du projet

Voir `PROGRESS.md` (phase en cours) et `backend-architecture.md` (architecture de
référence). **Phase 0 (infrastructure) livrée** — aucune fonctionnalité métier encore
implémentée (auth, classes, cours, etc. arrivent phase par phase).

## Démarrage local

```bash
cp .env.example .env
# éditer .env si besoin (CORS_ALLOWED_ORIGINS notamment)

docker compose up -d        # Postgres (+ Redis, utilisé à partir de la Phase 6/7)

npm install
npx prisma migrate dev --name init_schema   # génère + applique la migration initiale

npm run start:dev
```

`GET http://localhost:3000/api/v1/health` doit répondre `200` avec
`data.info.database.status = "up"`.

## Tests

```bash
npm run test        # unitaires (aucune dépendance externe)
npm run test:e2e    # e2e — nécessite `docker compose up -d` (PrismaModule se connecte au démarrage)
npm run test:cov    # couverture
```

## Prisma

```bash
npm run prisma:generate        # régénère le client après une modif de schema.prisma
npm run prisma:migrate         # nouvelle migration en dev
npm run prisma:migrate:deploy  # applique les migrations existantes (CI/prod)
npm run prisma:studio          # explorateur de données local
```

## Lint / format

```bash
npm run lint
npm run format
```

## Principes de développement de ce dépôt

- Une fonctionnalité = une tâche : voir `PROGRESS.md` pour l'ordre des phases.
- Sécurité non négociable : voir `docs/security.md` avant toute nouvelle route.
- Toute permission est recalculée côté backend — jamais de confiance dans les valeurs
  envoyées par le client (`userId`, `role`, `classId`, `courseId`, `permissions`).
