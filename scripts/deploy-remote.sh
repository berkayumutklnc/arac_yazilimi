#!/usr/bin/env bash
# VPS üzerinde çalışır — hem .github/workflows/deploy.yml (SSH ile) hem elle
# çağrılabilir. Repo kökünde (docker-compose.prod.yml'in yanında) çalıştırılmalı.
# Kullanım: IMAGE_TAG=v1.2.3 ./scripts/deploy-remote.sh
# Adım adım açıklama: docs/runbook.md "Dağıtım" ve "Geri Alma".
#
# `docker compose up --wait`, healthcheck tanımlı her servisin "healthy"
# olmasını bekler ve olmazsa non-zero exit ile döner (set -e bunu yukarı
# taşır) — ayrı bir manuel health-poll döngüsüne gerek bırakmaz.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

if [ ! -f .env.production ]; then
  echo "[deploy] HATA: .env.production bulunamadı (bkz. .env.production.example, docs/runbook.md)." >&2
  exit 1
fi

export IMAGE_TAG="${IMAGE_TAG:-latest}"
COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env.production)

echo "[deploy] IMAGE_TAG=${IMAGE_TAG} — imajlar çekiliyor"
"${COMPOSE[@]}" pull

echo "[deploy] backup imajı build ediliyor (registry'de değil, yerel build)"
"${COMPOSE[@]}" build backup

echo "[deploy] bağımlılık servisleri başlatılıyor (postgres, minio, diag-service)"
"${COMPOSE[@]}" up -d --wait postgres minio diag-service

echo "[deploy] MinIO bucket/lifecycle kurulumu (idempotent)"
"${COMPOSE[@]}" up minio-init --exit-code-from minio-init

echo "[deploy] veritabanı migration'ları uygulanıyor (migrate deploy — ASLA db push)"
"${COMPOSE[@]}" run --rm api npx prisma migrate deploy

echo "[deploy] tüm servisler güncelleniyor"
"${COMPOSE[@]}" up -d --remove-orphans --wait

echo "[deploy] tamamlandı — IMAGE_TAG=${IMAGE_TAG} çalışıyor"
