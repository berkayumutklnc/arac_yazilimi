#!/usr/bin/env bash
# Gecelik pg_dump → gzip → MinIO. `ops/backup` container'ının crond'u
# tarafından her gece 03:00'te çalıştırılır (bkz. ops/backup/crontab).
# 30 günlük saklama MinIO bucket lifecycle kuralıyla otomatik uygulanır
# (bkz. docker-compose.prod.yml minio-init) — bu script SİLME yapmaz, tek
# sorumluluğu dump + yükleme.
set -euo pipefail

: "${PGHOST:?PGHOST gerekli}"
: "${POSTGRES_USER:?POSTGRES_USER gerekli}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD gerekli}"
: "${POSTGRES_DB:?POSTGRES_DB gerekli}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER gerekli}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD gerekli}"

BACKUP_BUCKET="arac-yazilim-backups"
TIMESTAMP="$(date -u +%Y-%m-%d_%H%M%S)"
FILENAME="arac_yazilim_${TIMESTAMP}.sql.gz"
TMP_PATH="/tmp/${FILENAME}"

echo "[backup] ${TIMESTAMP} — pg_dump başlıyor (db=${POSTGRES_DB})"
PGPASSWORD="${POSTGRES_PASSWORD}" pg_dump \
  --host "${PGHOST}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --no-owner --no-privileges \
  | gzip > "${TMP_PATH}"

echo "[backup] mc alias ayarlanıyor"
mc alias set local http://minio:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null

echo "[backup] yükleniyor: ${BACKUP_BUCKET}/postgres/${FILENAME}"
mc cp "${TMP_PATH}" "local/${BACKUP_BUCKET}/postgres/${FILENAME}"

rm -f "${TMP_PATH}"
echo "[backup] tamamlandı: ${FILENAME}"
