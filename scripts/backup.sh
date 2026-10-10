#!/bin/sh
# =============================================================================
# Backup PostgreSQL — Classe Intelligente
# Exécuté quotidiennement par le conteneur backup (docker-compose.prod.yml)
# =============================================================================
# Variables requises dans .env.production :
#   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME
#
# Les sauvegardes sont chiffrées avant stockage (openssl AES-256-CBC).
# La clé de chiffrement est dans BACKUP_ENCRYPTION_KEY (env).
#
# Rétention : 7 jours (les fichiers plus anciens sont supprimés automatiquement).
# =============================================================================

set -e

BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d_%H%M%S)
FILENAME="${BACKUP_DIR}/backup_${DATE}.sql.gz.enc"
RETENTION_DAYS=7

echo "[$(date)] Démarrage backup..."

# Dump + compression + chiffrement en pipeline (jamais de fichier non chiffré sur disque)
PGPASSWORD="${DB_PASSWORD}" pg_dump \
  -h "${DB_HOST:-postgres}" \
  -U "${DB_USER}" \
  -d "${DB_NAME}" \
  --no-password \
  --format=custom \
  --compress=9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 100000 \
      -pass pass:"${BACKUP_ENCRYPTION_KEY}" \
  > "${FILENAME}"

echo "[$(date)] Backup créé : ${FILENAME} ($(du -h "${FILENAME}" | cut -f1))"

# Supprimer les sauvegardes plus anciennes que RETENTION_DAYS jours
find "${BACKUP_DIR}" -name "backup_*.sql.gz.enc" \
  -mtime "+${RETENTION_DAYS}" -delete

echo "[$(date)] Backup terminé. Fichiers conservés :"
ls -lh "${BACKUP_DIR}"/backup_*.sql.gz.enc 2>/dev/null || echo "  (aucun)"

# Restauration :
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
#     -pass pass:"${BACKUP_ENCRYPTION_KEY}" \
#     -in backup_YYYYMMDD_HHMMSS.sql.gz.enc \
#   | pg_restore -h localhost -U postgres -d classe_intelligente
