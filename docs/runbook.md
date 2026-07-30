# Runbook — Üretim Dağıtımı (Tek VPS, Docker Compose)

Mimari kararlar için bkz. `docs/adr/0015-production-deployment-architecture.md`.
Bu doküman yalnızca "ne yapılır, nasıl yapılır"ı adım adım anlatır.

**Önemli:** Bu runbook'taki adımlar, geliştirme ortamında (bu depo Docker'sız
bir makinede hazırlandı) **gerçek bir VPS'te hiç çalıştırılmadı/doğrulanmadı**.
İlk kurulumda dikkatli ilerleyin, her adımdan sonra çıktıyı kontrol edin.

## 0. Ön koşullar

- Bir VPS (Ubuntu 22.04+ önerilir), en az 2 vCPU / 4GB RAM (compose'daki
  kaynak limitleri toplamına göre ayarlayın — `docker-compose.prod.yml`).
- İki DNS A kaydı, VPS'in IP'sine işaret eden: `app.example.com` ve
  `api.example.com` (gerçek alan adınızla — bkz. `.env.production.example`
  `APP_DOMAIN`/`API_DOMAIN`). Caddy'nin otomatik TLS alabilmesi için bu
  kayıtların dağıtımdan ÖNCE yayılmış (propagate) olması gerekir.
- GHCR'dan imaj çekebilmek için bir GitHub PAT (`read:packages` yetkili).
- Repo'ya push yetkisi olan bir GitHub Actions ortamı (deploy secret'ları
  aşağıda).

## 1. Kurulum (ilk kez)

### 1.1 Docker + Compose kurulumu

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
# Oturumu kapatıp tekrar açın (grup değişikliğinin etkili olması için).
docker compose version   # Compose v2 doğrulaması
```

### 1.2 Repo'yu klonlayın

```bash
git clone https://github.com/<owner>/<repo>.git ~/arac-yazilim
cd ~/arac-yazilim
```

### 1.3 GHCR'a giriş yapın (VPS'te BİR KEZ)

```bash
# GitHub → Settings → Developer settings → Personal access tokens →
# "read:packages" yetkili bir token oluşturun.
echo "<PAT>" | docker login ghcr.io -u <github-kullanici-adi> --password-stdin
```

Bu, Docker'ın kendi credential store'una kaydedilir — bir daha CI'dan bu PAT'i
geçirmeye gerek yok (bkz. ADR 0015 sır yönetimi kararı).

### 1.4 `.env.production` oluşturun

```bash
cp .env.production.example .env.production
chmod 600 .env.production
# Her CHANGE_ME'yi gerçek bir değerle değiştirin. Sır üretmek için:
openssl rand -base64 32
```

Doldurulması gereken alanlar: `GHCR_NAMESPACE` (kendi `ghcr.io/<owner>/<repo>`
adresiniz), `APP_DOMAIN`/`API_DOMAIN`/`NEXT_PUBLIC_API_URL`/`WEB_APP_BASE_URL`
(gerçek alan adlarınız), `POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`,
`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`, `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY`
(MinIO için — `MINIO_ROOT_USER`/`PASSWORD` ile aynı değerleri kullanabilirsiniz
veya ayrı bir uygulama kullanıcısı oluşturabilirsiniz), `PLATFORM_ADMIN_EMAIL`/
`PLATFORM_ADMIN_INITIAL_PASSWORD`.

**`.env.production` ASLA commit edilmez** (`.gitignore`'da) — yalnızca bu
dosyanın VPS'teki kopyası gerçek sırları taşır.

### 1.5 GitHub Actions sırlarını ekleyin

Repo → Settings → Secrets and variables → Actions:

| Sır                   | Değer                                                                       |
| --------------------- | --------------------------------------------------------------------------- |
| `VPS_HOST`            | VPS'in IP adresi veya hostname'i                                            |
| `VPS_USER`            | SSH kullanıcı adı (deploy için ayrı, kısıtlı bir kullanıcı önerilir)        |
| `VPS_SSH_PRIVATE_KEY` | Yukarıdaki kullanıcının özel SSH anahtarı (parolasız, yalnızca deploy için) |

### 1.6 İlk dağıtımı elle çalıştırın

```bash
cd ~/arac-yazilim
IMAGE_TAG=latest ./scripts/deploy-remote.sh
```

Bu, `docker-compose.prod.yml`'deki tüm servisleri ayağa kaldırır, MinIO
bucket'larını kurar, `prisma migrate deploy` çalıştırır. İlk defasında
`caddy`'nin TLS sertifikası alması birkaç dakika sürebilir — `docker compose
-f docker-compose.prod.yml logs -f caddy` ile izleyin.

### 1.7 İlk SUPER_ADMIN'i oluşturun (bkz. ADR 0010)

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm api npm run bootstrap:platform-admin
```

### 1.8 Uptime cron'unu kurun (VPS host crontab'ı — container İÇİNDE DEĞİL)

```bash
crontab -e
```

Şu satırı ekleyin (kendi domain'lerinizle):

```
*/5 * * * * APP_DOMAIN=app.example.com API_DOMAIN=api.example.com UPTIME_WEBHOOK_URL=https://... /home/<user>/arac-yazilim/scripts/uptime-check.sh
```

`UPTIME_WEBHOOK_URL` opsiyonel — verilmezse yalnızca
`/var/log/arac-yazilim-uptime.log`'a yazar.

## 2. Dağıtım (normal akış)

Her sürüm çıkışında:

```bash
git tag vX.Y.Z
git push --tags
```

`.github/workflows/deploy.yml` tetiklenir: üç imajı build edip GHCR'a push
eder, sonra SSH ile VPS'e bağlanıp `scripts/deploy-remote.sh`'ı çalıştırır.
GitHub Actions sekmesinden ilerlemeyi izleyin.

**Elle dağıtım** (CI'ı bypass etmek isterseniz — ör. bir imaj zaten registry'de
varsa):

```bash
cd ~/arac-yazilim
git fetch --tags && git checkout vX.Y.Z
IMAGE_TAG=vX.Y.Z ./scripts/deploy-remote.sh
```

## 3. Geri Alma (Rollback)

İmaj registry'de zaten var — yeniden build GEREKMEZ, yalnızca önceki tag'e
geri dönün:

```bash
cd ~/arac-yazilim
git checkout vX.Y.Z-1   # bir önceki çalışan sürüm
IMAGE_TAG=vX.Y.Z-1 ./scripts/deploy-remote.sh
```

**Dikkat:** Eğer geri alınan sürüm ile aradaki sürüm arasında bir Prisma
migration'ı varsa, `deploy-remote.sh` içindeki `prisma migrate deploy` YENİ
migration'ları geri ALMAZ (Prisma migration'ları ileri-yönlüdür). Şema geri
almak gerekiyorsa elle bir "down" migration yazılmalı veya "Yedekten Dönme"
(madde 4) kullanılmalı. Basit uygulama-kodu rollback'lerinde (migration'sız
sürümler arası) yukarıdaki adım yeterlidir.

## 4. Yedekten Dönme

**DESTRUCTIVE** — hedef veritabanının mevcut içeriğini kalıcı olarak
değiştirir. Önce mevcut duruma da bir yedek almayı düşünün.

```bash
cd ~/arac-yazilim

# Mevcut yedekleri listele:
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm backup mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" \
  && docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm backup mc ls local/arac-yazilim-backups/postgres/

# Geri yükle (dosya adını yukarıdaki listeden alın):
docker compose -f docker-compose.prod.yml --env-file .env.production \
  run --rm backup /scripts/restore.sh arac_yazilim_2026-07-30_030000.sql.gz
```

Onay istemi çıkar ("evet" yazmanız gerekir) — otomasyonda kullanmak için
`--yes` ikinci parametre olarak eklenebilir (dikkatli kullanın).

Geri yükleme sonrası `api`'yi yeniden başlatmanız önerilir (bağlantı havuzu
tutarlılığı için):

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production restart api
```

## 5. Sır Yönetimi Kuralları

- `.env.production` ASLA repo'ya commit edilmez, VPS'te `chmod 600`.
- Sırlar `openssl rand -base64 32` ile üretilir — tahmin edilebilir/tekrar
  kullanılan değerler yasak.
- GHCR push CI'da `GITHUB_TOKEN` ile yapılır (ek sır gerekmez). VPS'ten
  GHCR'a `docker login` ayrı, uzun ömürlü bir PAT ile ve yalnızca VPS'te
  saklanır (bkz. madde 1.3) — bu PAT hiçbir GitHub Actions sırrına
  eklenmez.
- `VPS_SSH_PRIVATE_KEY` yalnızca deploy amaçlı, kısıtlı bir kullanıcıya ait
  olmalı (root değil) — bkz. madde 1.5.
- Sır rotasyonu gerektiğinde: `.env.production`'da değeri değiştirin,
  `./scripts/deploy-remote.sh` çalıştırın (servisler yeni değerle yeniden
  başlar). `JWT_ACCESS_SECRET` rotasyonu TÜM aktif access token'ları
  geçersiz kılar (kullanıcılar yeniden giriş yapmalı).

## 6. Sorun Giderme

- **Caddy TLS alamıyor:** DNS kayıtlarının gerçekten VPS IP'sine işaret
  ettiğini doğrulayın (`dig app.example.com`), `docker compose logs caddy`.
  80/443 portlarının güvenlik duvarında açık olduğunu doğrulayın.
- **`migrate deploy` başarısız:** `docker compose logs postgres` ile
  Postgres'in gerçekten healthy olduğunu doğrulayın; `DATABASE_URL`'in
  `docker-compose.prod.yml`'de doğru enjekte edildiğini kontrol edin.
- **Bir servis "unhealthy" kalıyor:** `docker compose ps` durumu gösterir,
  `docker compose logs <servis>` detay verir. Kaynak limitleri (`deploy.resources.limits`
  — `docker-compose.prod.yml`) VPS'in gerçek kapasitesine göre düşükse
  servis OOM ile kapanabilir — limitleri VPS'inize göre ayarlayın.
