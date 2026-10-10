# syntax=docker/dockerfile:1
# =============================================================================
# Classe Intelligente — Dockerfile multi-stage
# =============================================================================
#
# Stages :
#   deps      → dépendances npm (cache layer)
#   build     → compilation TypeScript + génération client Prisma
#   production → image finale minimale (non-root, deps prod seulement)
#
# Build : docker build -t classe-intelligente:latest .
# Run   : docker run --env-file .env.production -p 3000:3000 classe-intelligente:latest

FROM node:22-alpine AS deps
WORKDIR /app
# Copier uniquement les fichiers de dépendances pour maximiser le cache Docker.
# Si package.json ne change pas, cette couche est réutilisée sans npm ci.
COPY package*.json ./
RUN npm ci --no-audit

# -----------------------------------------------------------------------------
FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Générer le client Prisma AVANT le build TypeScript (types nécessaires)
RUN npx prisma generate
RUN npm run build

# -----------------------------------------------------------------------------
FROM node:22-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

# Ne jamais tourner en root dans le conteneur — attaque contenue en cas d'exploit.
RUN addgroup -S app && adduser -S app -G app

COPY package*.json ./
# Dépendances de production uniquement (pas de devDependencies ni test tools).
RUN npm ci --omit=dev --no-audit

# Copier le build et le schéma Prisma (nécessaire pour les migrations runtime).
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

# L'utilisateur non-root ne peut pas écrire dans le répertoire de travail
# (protection en écriture) — les logs vont sur stdout/stderr, pas sur disque.
USER app

EXPOSE 3000

# Healthcheck intégré : Docker Swarm / Kubernetes peut détecter un conteneur mort
# sans dépendance à un outil externe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/main.js"]
