#!/bin/sh
# =============================================================================
# Restauration backup PostgreSQL — Classe Intelligente
# =============================================================================
# Usage :
#   ./scripts/restore.sh backup_20261001_030000.sql.gz.enc
#
# Variables requises :
#   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, BACKUP_ENCRYPTION_KEY
#
# ATTENTION : la restauration écrase la base cible.
# Faire un backup de la base actuelle AVANT de lancer ce script.
# =============================================================================

set -e

BACKUP_FILE="${1}"

if [ -z "${BACKUP_FILE}" ]; then
  echo "Usage : $0 <fichier_backup.sql.gz.enc>"
  exit 1
fi

if [ ! -f "${BACKUP_FILE}" ]; then
  echo "Erreur : fichier introuvable : ${BACKUP_FILE}"
  exit 1
fi

echo "[$(date)] Début de la restauration depuis ${BACKUP_FILE}"
echo "  Base cible : ${DB_NAME} @ ${DB_HOST:-localhost}"
echo ""
echo "  ATTENTION : cette opération va écraser la base de données."
printf "  Tapez 'RESTORE' pour confirmer : "
read -r CONFIRM

if [ "${CONFIRM}" != "RESTORE" ]; then
  echo "Restauration annulée."
  exit 0
fi

echo "[$(date)] Déchiffrement et restauration en cours..."

openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 \
  -pass pass:"${BACKUP_ENCRYPTION_KEY}" \
  -in "${BACKUP_FILE}" \
| PGPASSWORD="${DB_PASSWORD}" pg_restore \
    -h "${DB_HOST:-postgres}" \
    -U "${DB_USER}" \
    -d "${DB_NAME}" \
    --no-password \
    --clean \
    --if-exists \
    --verbose

echo "[$(date)] Restauration terminée."
echo "  Vérifier l'intégrité de la base avant de relancer l'application."
