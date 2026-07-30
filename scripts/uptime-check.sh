#!/usr/bin/env bash
# Basit uptime kontrolü — VPS'in kendi crontab'ında çalışır (host üzerinde,
# container İÇİNDE DEĞİL — dış dünyadan gerçek TLS/proxy zincirini test eder).
# Kurulum: docs/runbook.md "Kurulum" bölümü. Örnek crontab satırı:
#   */5 * * * * APP_DOMAIN=app.example.com API_DOMAIN=api.example.com \
#     /path/to/arac-yazilim/scripts/uptime-check.sh
#
# UPTIME_WEBHOOK_URL verilmezse yalnızca yerel log dosyasına yazar — dışarıya
# hiçbir bağımlılık yok (bkz. docs/adr/0015).
set -euo pipefail

: "${APP_DOMAIN:?APP_DOMAIN gerekli}"
: "${API_DOMAIN:?API_DOMAIN gerekli}"

LOG_FILE="${UPTIME_LOG_FILE:-/var/log/arac-yazilim-uptime.log}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

check() {
  local name="$1"
  local url="$2"
  if curl -fsS --max-time 10 "${url}" >/dev/null 2>&1; then
    echo "${TIMESTAMP} OK ${name} ${url}" >>"${LOG_FILE}"
    return 0
  fi

  echo "${TIMESTAMP} FAIL ${name} ${url}" >>"${LOG_FILE}"
  if [ -n "${UPTIME_WEBHOOK_URL:-}" ]; then
    curl -fsS --max-time 10 -X POST \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"[arac-yazilim] uptime check FAILED: ${name} (${url}) at ${TIMESTAMP}\"}" \
      "${UPTIME_WEBHOOK_URL}" >/dev/null 2>&1 || true
  fi
  return 1
}

STATUS=0
check "web" "https://${APP_DOMAIN}/api/health" || STATUS=1
check "api" "https://${API_DOMAIN}/health" || STATUS=1

exit "${STATUS}"
