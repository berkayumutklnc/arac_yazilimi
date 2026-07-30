#!/usr/bin/env bash
# Bir MinIO yedeğini indirip veritabanının ÜZERİNE geri yükler.
# ÇALIŞTIRILDIĞI YER: `backup` container'ı içinde (psql/mc burada kurulu) —
#   docker compose -f docker-compose.prod.yml run --rm backup /scripts/restore.sh <dosya-adı>
# Adım adım kullanım: docs/runbook.md "Yedekten Dönme".
#
# DESTRUCTIVE: hedef veritabanının mevcut içeriğini geri dönülemez şekilde
# değiştirir. --yes verilmezse interaktif onay ister.
set -euo pipefail

BACKUP_FILE="${1:-}"
CONFIRM_FLAG="${2:-}"

if [ -z "${BACKUP_FILE}" ]; then
  echo "Kullanım: $0 <yedek-dosya-adı> [--yes]"
  echo "Mevcut yedekleri listelemek için: mc ls local/arac-yazilim-backups/postgres/"
  exit 1
fi

: "${PGHOST:?PGHOST gerekli}"
: "${POSTGRES_USER:?POSTGRES_USER gerekli}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD gerekli}"
: "${POSTGRES_DB:?POSTGRES_DB gerekli}"
: "${MINIO_ROOT_USER:?MINIO_ROOT_USER gerekli}"
: "${MINIO_ROOT_PASSWORD:?MINIO_ROOT_PASSWORD gerekli}"

if [ "${CONFIRM_FLAG}" != "--yes" ]; then
  echo "UYARI: Bu işlem '${POSTGRES_DB}' veritabanının ÜZERİNE YAZAR — mevcut veri kaybolur."
  read -r -p "Devam etmek için 'evet' yazın: " ANSWER
  if [ "${ANSWER}" != "evet" ]; then
    echo "İptal edildi."
    exit 1
  fi
fi

TMP_PATH="/tmp/${BACKUP_FILE}"
BACKUP_BUCKET="arac-yazilim-backups"

echo "[restore] mc alias ayarlanıyor"
mc alias set local http://minio:9000 "${MINIO_ROOT_USER}" "${MINIO_ROOT_PASSWORD}" >/dev/null

echo "[restore] indiriliyor: ${BACKUP_BUCKET}/postgres/${BACKUP_FILE}"
mc cp "local/${BACKUP_BUCKET}/postgres/${BACKUP_FILE}" "${TMP_PATH}"

echo "[restore] '${POSTGRES_DB}' veritabanına geri yükleniyor"
gunzip -c "${TMP_PATH}" | PGPASSWORD="${POSTGRES_PASSWORD}" psql \
  --host "${PGHOST}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}"

rm -f "${TMP_PATH}"
echo "[restore] tamamlandı: ${BACKUP_FILE}"
