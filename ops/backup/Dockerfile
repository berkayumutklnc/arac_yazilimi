# syntax=docker/dockerfile:1
#
# Build context KÖK dizin (docker-compose.prod.yml: backup.build.context: .)
# — scripts/backup.sh kök scripts/ dizininde yaşıyor (bkz. docs/adr/0015).

FROM alpine:3.20
RUN apk add --no-cache postgresql16-client bash tzdata ca-certificates curl
# MinIO client (mc) — Alpine paket deposunda yok, resmi statik binary.
RUN curl -fsSL -o /usr/local/bin/mc https://dl.min.io/client/mc/release/linux-amd64/mc \
    && chmod +x /usr/local/bin/mc

COPY ops/backup/crontab /etc/crontabs/root
COPY scripts/backup.sh /scripts/backup.sh
RUN chmod +x /scripts/backup.sh

CMD ["crond", "-f", "-l", "2"]
