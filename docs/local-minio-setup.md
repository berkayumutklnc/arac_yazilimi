# Yerel MinIO Kurulumu (ECU Dosya Deposu — S3 Uyumlu)

`apps/api/src/storage/s3EcuFileStorage.ts`, `@aws-sdk/client-s3` üzerinden herhangi bir
S3-uyumlu depoya konuşur. Yerel geliştirmede bu MinIO'dur.

## Native kurulum (önerilen — bu makinede zaten yapıldı)

Docker bu makinede kurulu değil (bkz. `docs/local-postgres-setup.md`), ama MinIO'nun
winget paketi **"portable"** — Postgres'in aksine Windows servisi/UAC gerektirmiyor. Bu
oturumda gerçekten kuruldu ve doğrulandı:

```powershell
winget install --id MinIO.Server --accept-package-agreements --accept-source-agreements
winget install --id MinIO.Client --accept-package-agreements --accept-source-agreements
```

İkisi de `%LOCALAPPDATA%\Microsoft\WinGet\Packages\...\{minio,mc}.exe` altına kuruldu;
`Path` güncellendi ama yeni bir terminalde `minio`/`mc` komutları olarak kullanılabilir
(mevcut oturumda `Path` yenilenmediği için tam yol gerekebilir).

**Not:** Bu ajan oturumunun shell'i kalıcı arka plan süreçleri başlatamıyor (bir sonraki
adım — `minio server` — süresiz çalışan bir process, bu yüzden bu oturumda gerçekten
ayağa kaldırıp `s3EcuFileStorage`'a karşı canlı bir smoke test çalıştırılamadı). Aşağıdaki
adımları siz kendi terminalinizde çalıştırın:

```powershell
$env:MINIO_ROOT_USER = "arac_yazilim_dev"
$env:MINIO_ROOT_PASSWORD = "devlocal_minio_2026"
minio server "$env:USERPROFILE\minio-data" --address ":9000" --console-address ":9001"
```

Bu komut terminali işgal eder (sunucu foreground'da çalışır) — ayrı bir terminalde bırakın
veya kendi arka plan mekanizmanızla (ör. yeni bir pencere) başlatın. Konsol:
`http://localhost:9001` (kullanıcı/şifre yukarıdaki gibi).

### Bucket oluşturma (private — asla public yapmayın)

Ayrı bir terminalde, MinIO ayaktayken:

```powershell
mc alias set local http://localhost:9000 arac_yazilim_dev devlocal_minio_2026
mc mb local/arac-yazilim-ecu-files
# Varsayılan zaten private ama güvence olarak:
mc anonymous set none local/arac-yazilim-ecu-files
```

## docker-compose alternatifi

Docker kurulu bir makinede (bu makinede DEĞİL — bkz. yukarıdaki not), repo kökündeki
`docker-compose.yml` aynı kullanıcı/şifre/portlarla bir `minio` servisi tanımlıyor:

```bash
docker compose up -d minio
```

Bucket oluşturma adımları native kurulumla birebir aynı (`mc alias set` / `mc mb` /
`mc anonymous set none`).

## `apps/api/.env` değişkenleri

```
S3_ENDPOINT="http://localhost:9000"
S3_REGION="us-east-1"
S3_BUCKET="arac-yazilim-ecu-files"
S3_ACCESS_KEY_ID="arac_yazilim_dev"
S3_SECRET_ACCESS_KEY="devlocal_minio_2026"
S3_FORCE_PATH_STYLE="true"
```

`S3_FORCE_PATH_STYLE=true` **zorunlu** — MinIO, S3'ün varsayılan virtual-hosted-style
(`bucket.endpoint.com`) DNS çözümlemesini desteklemiyor, path-style
(`endpoint.com/bucket`) gerekiyor.

## Doğrulama

- `apps/api/src/storage/s3EcuFileStorage.test.ts` — presigned URL üretimi (offline,
  gerçek imzalama) + `readObjectSha256` (fake `S3Client.send`) — bu oturumda çalıştırıldı,
  yeşil.
- MinIO ayağa kalktıktan sonra gerçek bir uçtan-uca doğrulama için: `npm run dev`
  (`apps/api`) ile sunucuyu başlatıp `POST /vehicles/:id/ecu-files/upload-request` →
  dönen `uploadUrl`'e gerçek bir `PUT` → `upload-confirm` akışını elle deneyin.
