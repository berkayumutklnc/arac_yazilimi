# ADR 0015 — Üretim Dağıtım Mimarisi: Tek VPS + Docker Compose

**Karar (topoloji):** Tek VPS'te Docker Compose ile altı servis çalışır:
`caddy` (reverse proxy + otomatik TLS), `web` (Next.js standalone), `api`
(Fastify), `diag-service` (FastAPI), `postgres`, `minio`. Yalnızca `caddy`
host'a port yayınlar (80/443) — `postgres`/`minio`/`diag-service` yalnızca
compose'un `data` ağı üzerinden servis adıyla erişilir, host'a hiç açılmaz.
Caddy, gerçek bir alan adı kullanıldığında sertifikayı otomatik alır/yeniler
(Let's Encrypt) — bu, tek-VPS ölçeğinde ayrı bir cert-manager/nginx+certbot
kurulumundan çok daha az işletim yüküyle aynı sonucu verir.

**Karar (imaj registry + CI/CD):** GHCR (`ghcr.io/<owner>/<repo>-<servis>`) —
repo zaten GitHub Actions kullanıyor, `GITHUB_TOKEN` ile push için ek bir sır
gerekmiyor. Dağıtım tag-tetiklemeli: `git push --tags` → `.github/workflows/deploy.yml`
üç imajı build edip push eder → `appleboy/ssh-action` ile VPS'e bağlanıp
`scripts/deploy-remote.sh`'ı çalıştırır (`compose pull` → bağımlılık
servislerinin healthy olmasını bekle → `prisma migrate deploy` → `up -d --wait`).
VPS'in GHCR'a `docker login`'i CI sırrı DEĞİL — yalnızca VPS'te bir kez, uzun
ömürlü bir `read:packages` PAT ile yapılır (bkz. docs/runbook.md).

**Karar (Prisma binary target):** `apps/api/prisma/schema.prisma`'nın
`generator client` bloğuna `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]`
eklendi. Bu görevde doğrulandı: eklenmeden `node:22-alpine` (musl libc)
üretim imajında Prisma Client "query engine bulunamadı" hatasıyla başlangıçta
çöküyordu — yerel geliştirmede (Windows "native" hedefi) bu hiç görünmüyordu.
`@node-rs/argon2`'nin musl prebuild'i zaten mevcut (`@node-rs/argon2-linux-x64-musl`),
bu yüzden Alpine tabanı (glibc/Debian yerine) korunabildi.

**Karar (yedekleme):** Gecelik `pg_dump | gzip` → MinIO `arac-yazilim-backups`
bucket'ına (`ops/backup/` container'ı, busybox crond, 03:00 UTC). 30 günlük
saklama, script'in kendisinde DEĞİL, MinIO bucket lifecycle kuralında (`mc ilm
add --expire-days 30`, `minio-init` servisi tarafından idempotent kurulur) —
saklama politikası ile yükleme mekanizması ayrık, birbirini etkilemez.

**Karar (gözlemlenebilirlik minimumu):** Yapılandırılmış (pino, JSON) log +
KVKK redaksiyonu yalnızca `api`'de (bkz. `docs/security-audit.md` ORTA-2'nin
kendi önerisi) — diğer servisler Docker'ın `json-file` log driver'ına
(`docker-compose.prod.yml` `x-logging`, tüm servislerde, log rotasyonlu)
bırakıldı; bu servislerde ayrı bir uygulama-içi JSON formatter eklemek
"minimum" kapsamını aşardı, bilinçli olarak yapılmadı. Uptime kontrolü VPS'in
kendi crontab'ında çalışan `scripts/uptime-check.sh` — harici bir SaaS'a
bağımlılık yok, webhook opsiyonel.

**Kısıt:** Bu ortamda Docker kurulu değil — bu ADR'ı ve ilgili dosyaları
üreten oturumda gerçek bir `docker build`/`compose up`/SSH deploy/TLS alımı/
`pg_dump`+restore denemesi YAPILAMADI. Doğrulama; `apps/api`/`apps/web`'in
gerçek `npm run build` çıktısının (Prisma musl binary'si, Next.js standalone
yolu) doğrudan incelenmesiyle, script'lerin `bash -n` sözdizim kontrolüyle ve
YAML dosyalarının `python -c "import yaml"` ile ayrıştırılmasıyla sınırlı
kaldı. İlk gerçek VPS kurulumu `docs/runbook.md`'deki adımlarla yapılmalı.

**Durum:** Dockerfile'lar/compose/Caddyfile/backup+deploy+uptime script'leri/
CI workflow'u eklendi. Gerçek bir VPS'te ilk uçtan uca doğrulama henüz
yapılmadı — bu ADR'ın "Kısıt" bölümündeki nedenle.
