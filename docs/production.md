# GUIDE DE PRODUCTION — Classe Intelligente

Ce document couvre le déploiement initial et les opérations courantes en production.

---

## 1. Prérequis

- Docker 24+ et Docker Compose V2
- Un compte S3/R2/MinIO pour le stockage des documents
- Une clé API OpenAI (ou compatible : Azure OpenAI, Mistral via `OPENAI_BASE_URL`)
- Un serveur avec au minimum : 2 vCPU, 4 Go RAM, 40 Go disque
- Un reverse proxy avec TLS (Nginx, Caddy, Traefik)

---

## 2. Déploiement initial

### 2.1 Secrets

Ne jamais écrire les secrets dans Git. Créer `.env.production` sur le serveur :

```bash
cp .env.example .env.production
# Remplir TOUTES les variables, en particulier :
#   DATABASE_URL, JWT_ACCESS_SECRET, JWT_REFRESH_SECRET,
#   STORAGE_*, OPENAI_API_KEY, REDIS_URL, BACKUP_ENCRYPTION_KEY
```

Recommandation : utiliser un gestionnaire de secrets (Vault, Doppler, AWS SSM).

### 2.2 Premier démarrage

```bash
# Démarrer la DB et Redis
docker compose -f docker-compose.prod.yml up -d postgres redis

# Attendre que Postgres soit healthy
docker compose -f docker-compose.prod.yml ps

# Appliquer les migrations (user avec droits DDL)
docker run --rm \
  -e DATABASE_URL="${DATABASE_URL_MIGRATE}" \
  classe-intelligente:latest \
  npx prisma migrate deploy

# Appliquer les migrations manuelles pgvector
docker exec postgres psql -U postgres -d classe_intelligente \
  -f /migrations/manual/phase8_pgvector_embeddings.sql
docker exec postgres psql -U postgres -d classe_intelligente \
  -f /migrations/manual/phase8_pgvector_indexes.sql

# Créer le compte ADMIN initial
docker run --rm \
  --env-file .env.production \
  -e ADMIN_EMAIL=admin@votre-domaine.com \
  -e ADMIN_PASSWORD="VotreMotDePasse@Sécurisé123" \
  -e ADMIN_FIRSTNAME=Admin \
  -e ADMIN_LASTNAME=System \
  classe-intelligente:latest \
  npx ts-node prisma/seed-admin.ts

# Démarrer l'API
docker compose -f docker-compose.prod.yml up -d api
```

### 2.3 Vérification

```bash
curl https://votre-domaine.com/api/v1/health
# Réponse attendue : {"data":{"status":"ok","info":{"database":{"status":"up"},...}}}
```

---

## 3. Variables d'environnement critiques

| Variable | Obligatoire | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | URL Postgres (user applicatif, droits DML uniquement) |
| `DATABASE_URL_MIGRATE` | ✅ CI/CD | URL Postgres (user migrations, droits DDL) |
| `JWT_ACCESS_SECRET` | ✅ | ≥ 32 caractères aléatoires, **différent** du refresh secret |
| `JWT_REFRESH_SECRET` | ✅ | ≥ 32 caractères aléatoires |
| `STORAGE_ENDPOINT` | ✅ | URL S3/R2/MinIO |
| `STORAGE_ACCESS_KEY` | ✅ | Clé d'accès stockage |
| `STORAGE_SECRET_KEY` | ✅ | Secret stockage |
| `OPENAI_API_KEY` | ✅ | Clé API LLM (embeddings + chat) |
| `REDIS_URL` | ✅ | URL Redis avec password en prod |
| `BACKUP_ENCRYPTION_KEY` | ✅ | Clé AES-256 pour chiffrer les sauvegardes |
| `MAX_ADMINS` | ⚙️ | Nombre max d'admins (défaut : 3, min : 2) |
| `NODE_ENV` | ✅ | `production` (active HSTS, etc.) |

---

## 4. CI/CD

Le pipeline `.github/workflows/ci.yml` s'exécute sur chaque PR et push :

```
Lint → Tests unitaires → Tests sécurité → Tests e2e → Audit deps → Docker build
```

Le push de l'image vers `ghcr.io` n'a lieu que sur merge dans `main`.

Le déploiement en production est **manuel** via `.github/workflows/deploy.yml`
(workflow_dispatch + confirmation + approbation GitHub Environments).

---

## 5. Migrations en production

**Règle absolue : migrations avant redémarrage de l'API.**

```bash
# Dans le pipeline deploy.yml (voir fichier)
docker run --rm \
  -e DATABASE_URL="${DATABASE_URL_MIGRATE}" \
  classe-intelligente:latest \
  npx prisma migrate deploy
```

Ne jamais utiliser `prisma migrate dev` en production (génère des fichiers locaux).

---

## 6. Sauvegardes

Le conteneur `backup` (docker-compose.prod.yml) effectue un dump quotidien à 03:00 UTC,
chiffré AES-256 avant écriture sur disque.

**Tester la restauration régulièrement :**

```bash
# Déchiffrer + restaurer sur un environnement de test
openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
  -pass pass:"${BACKUP_ENCRYPTION_KEY}" \
  -in /backups/backup_YYYYMMDD_HHMMSS.sql.gz.enc \
| pg_restore -h localhost -U postgres -d classe_intelligente_test
```

Une sauvegarde jamais testée n'est pas fiable.

---

## 7. Monitoring

Les logs applicatifs sont structurés (pino/JSON) sur stdout — les collecter avec :
- **Loki + Grafana** (auto-hébergé)
- **Datadog**, **CloudWatch**, **Papertrail** (SaaS)

Exemple de log structuré :
```json
{
  "level": "info",
  "time": "2026-09-22T19:58:44.839Z",
  "requestId": "req_550e8400-...",
  "endpoint": "POST /api/v1/auth/login",
  "status": 200,
  "duration": 312
}
```

Alertes recommandées :
- `status >= 500` sur une fenêtre glissante de 5 min
- Health check `/api/v1/health` → `database.status !== "up"`
- `errorCode: INTERNAL_ERROR` répété
- Job BullMQ en échec répété (`FAILED` dans `processing_jobs`)

---

## 8. Opérations courantes

### Créer un nouvel administrateur

```bash
POST /admin/users/admins
Authorization: Bearer <admin-token>

{
  "email": "newadmin@exemple.com",
  "firstName": "Prénom",
  "lastName": "Nom",
  "password": "MotDePasse@Sécurisé1"
}
```

### Forcer l'archivage d'une classe

```bash
PATCH /admin/classes/:classId/status/ARCHIVED
Authorization: Bearer <admin-token>
```

### Consulter les logs d'audit

```bash
GET /admin/audit?page=1&limit=20&action=ADMIN_SUSPEND_USER
Authorization: Bearer <admin-token>
```

---

## 9. Sécurité — checklist pré-déploiement

Voir `docs/security-checklist.md` pour la liste complète.

Points critiques :
- [ ] `npm run audit:deps` sans vulnérabilité HIGH/CRITICAL
- [ ] `.env.production` absent du dépôt Git (`.gitignore` vérifié)
- [ ] PostgreSQL et Redis non exposés sur Internet
- [ ] TLS/HTTPS configuré sur le reverse proxy
- [ ] `NODE_ENV=production` (active HSTS et désactive les logs de dev)
- [ ] Rotation des clés JWT planifiée
