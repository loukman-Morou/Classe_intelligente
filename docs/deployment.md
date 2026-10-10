# GUIDE DE DÉPLOIEMENT — Classe Intelligente

**Pré-requis :** Docker ≥ 24, Docker Compose v2, un accès SSH au serveur de production.

---

## 1. Première mise en production

### 1.1 Préparer le serveur

```bash
# Sur le serveur de production
sudo apt update && sudo apt install -y docker.io docker-compose-plugin postgresql-client

# Créer le répertoire de travail
sudo mkdir -p /opt/classe-intelligente
sudo chown $USER /opt/classe-intelligente
cd /opt/classe-intelligente

# Cloner uniquement les fichiers de configuration (pas le code — l'image vient du registre)
git clone https://github.com/VOTRE_ORG/classe-intelligente.git .
```

### 1.2 Configurer les secrets

```bash
# NE JAMAIS committer ce fichier
cp .env.example .env.production

# Remplir TOUTES les variables avec de vraies valeurs
# Utiliser un gestionnaire de secrets (Doppler, Vault, AWS SSM) si disponible
nano .env.production
```

Variables obligatoires à renseigner dans `.env.production` :

```env
DATABASE_URL=postgresql://classe_intelligente_app:MOT_DE_PASSE_FORT@postgres:5432/classe_intelligente
DB_USER=postgres
DB_PASSWORD=MOT_DE_PASSE_POSTGRES_FORT
DB_NAME=classe_intelligente

REDIS_URL=redis://:MOT_DE_PASSE_REDIS@redis:6379
REDIS_PASSWORD=MOT_DE_PASSE_REDIS_FORT

JWT_ACCESS_SECRET=<min 32 chars aléatoires>
JWT_REFRESH_SECRET=<min 32 chars aléatoires différents>

STORAGE_ENDPOINT=https://...
STORAGE_ACCESS_KEY=...
STORAGE_SECRET_KEY=...
STORAGE_BUCKET=classe-intelligente-prod

OPENAI_API_KEY=sk-...

CORS_ALLOWED_ORIGINS=https://votre-app.com

BACKUP_ENCRYPTION_KEY=<clé forte pour le chiffrement des backups>
```

### 1.3 Premier démarrage

```bash
cd /opt/classe-intelligente

# Démarrer PostgreSQL + Redis d'abord
docker compose -f docker-compose.prod.yml up -d postgres redis
sleep 15  # attendre la disponibilité

# Appliquer les migrations (user superuser postgres, pas le user applicatif)
export DATABASE_URL_MIGRATE="postgresql://postgres:${DB_PASSWORD}@localhost:5432/classe_intelligente"
docker run --rm --network classe-intelligente_internal \
  --env DATABASE_URL=${DATABASE_URL_MIGRATE} \
  ghcr.io/VOTRE_ORG/classe-intelligente:latest \
  npx prisma migrate deploy

# Appliquer les migrations manuelles pgvector
docker exec -it classe-intelligente-postgres-1 psql \
  -U postgres -d classe_intelligente \
  -f /tmp/phase8_pgvector_embeddings.sql

# Créer le compte admin initial
docker run --rm --network classe-intelligente_internal \
  --env-file .env.production \
  --env ADMIN_EMAIL=admin@votre-domaine.com \
  --env ADMIN_PASSWORD='MOT_DE_PASSE_FORT_12_CHARS+' \
  --env ADMIN_FIRSTNAME=Admin \
  --env ADMIN_LASTNAME=System \
  ghcr.io/VOTRE_ORG/classe-intelligente:latest \
  npx ts-node prisma/seed-admin.ts

# Démarrer l'API
docker compose -f docker-compose.prod.yml up -d

# Vérifier la santé
curl http://localhost:3000/api/v1/health
```

---

## 2. Déploiement d'une mise à jour

Le déploiement se fait via **GitHub Actions** (workflow `deploy.yml`) :

1. Aller dans l'onglet **Actions** du dépôt GitHub
2. Sélectionner le workflow **Deploy — Production**
3. Cliquer sur **Run workflow**
4. Renseigner le tag d'image (`sha-abc1234`, visible dans le workflow CI)
5. Taper `deploy` dans le champ de confirmation
6. Attendre l'approbation des reviewers configurés dans **GitHub Environments**

### Déploiement manuel d'urgence

```bash
cd /opt/classe-intelligente

IMAGE_TAG=sha-abc1234
docker pull ghcr.io/VOTRE_ORG/classe-intelligente:${IMAGE_TAG}

# Migrations avant redémarrage
docker run --rm --network classe-intelligente_internal \
  --env DATABASE_URL="${DATABASE_URL_MIGRATE}" \
  ghcr.io/VOTRE_ORG/classe-intelligente:${IMAGE_TAG} \
  npx prisma migrate deploy

# Redémarrer l'API uniquement (sans toucher DB/Redis)
IMAGE_TAG=${IMAGE_TAG} docker compose -f docker-compose.prod.yml up -d --no-deps api

# Vérifier
sleep 10 && curl http://localhost:3000/api/v1/health
```

---

## 3. Reverse proxy (Nginx exemple)

```nginx
server {
    listen 443 ssl http2;
    server_name api.classe-intelligente.com;

    ssl_certificate     /etc/letsencrypt/live/api.classe-intelligente.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.classe-intelligente.com/privkey.pem;

    # Sécurité TLS
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # Timeout aligné avec REQUEST_TIMEOUT_MS (30s + marge)
        proxy_read_timeout 35s;
    }
}

server {
    listen 80;
    server_name api.classe-intelligente.com;
    return 301 https://$server_name$request_uri;
}
```

---

## 4. Vérifications post-déploiement

```bash
# Santé de l'API et de la DB
curl https://api.classe-intelligente.com/api/v1/health

# Vérifier les logs récents (chercher des erreurs)
docker compose -f docker-compose.prod.yml logs --tail=100 api

# Vérifier que les jobs BullMQ tournent (Redis)
docker compose -f docker-compose.prod.yml exec redis \
  redis-cli -a ${REDIS_PASSWORD} LLEN bull:ocr-queue:wait

# Tester un endpoint protégé (doit retourner 401, pas 500)
curl -I https://api.classe-intelligente.com/api/v1/auth/me
```

---

## 5. Rollback

```bash
# Revenir à l'image précédente
PREVIOUS_TAG=sha-xxxxxxx
IMAGE_TAG=${PREVIOUS_TAG} docker compose -f docker-compose.prod.yml up -d --no-deps api
```

En cas de migration incompatible, contacter l'équipe avant tout rollback
(les migrations Prisma sont unidirectionnelles par défaut).
