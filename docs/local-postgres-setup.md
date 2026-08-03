# Yerel PostgreSQL 16 Kurulumu (Docker Yok — Native Windows)

Bu makinede Docker kurulu değil, bu yüzden `docker-compose.yml` yerine yerel
(native) bir PostgreSQL 16 kurulumu kullanılıyor. PostgreSQL kurulumu ve
`testcontainers` her ikisi de yönetici (UAC) onayı gerektiriyor ve bu ajanın
çalıştığı oturum interaktif olmadığı için otomatik CANCELED oluyor
(`0x800704c7`) — bu adımları **siz** kendi PowerShell/terminal oturumunuzda,
UAC istemini onaylayarak çalıştırmalısınız. Aşağıdaki adımlar bittiğinde
`prisma migrate dev` ve `npm run test:integration` çalışır hale gelir.

**Not (ADR 0008 sonrası):** Şema bu turda da genişledi (`AccessDeniedAuditLog` — bkz.
`docs/adr/0008-access-denied-audit-log.md`). Ayrı bir migration gerekmiyor — henüz hiç
migration çalıştırılmadığı için adım 4'teki tek `prisma migrate dev --name init` artık
güncel `schema.prisma`'nın TAMAMINI (unique index + AccessDeniedAuditLog dahil) kapsayacak.

**Not (ADR 0010-0013 sonrası — SUPER_ADMIN, davet, kullanıcı yönetimi, bayi bağlama):**
Şema yine genişledi (`Role.SUPER_ADMIN`, `Invitation`, `User.deactivatedAt`,
`UserManagementAuditLog`, `DealerAccountStatus` + `DealerAccount.{status,requestedBy,
approvedBy,respondedAt}`). Aynı gerekçeyle (henüz hiç migration yok) bunlar da adım 4'teki
`prisma migrate dev --name init`'e otomatik dahil olacak — ayrı bir migration adımı
GEREKMİYOR. Bu turda YENİ olan tek ek adım: **adım 5.5** (`bootstrap:platform-admin`,
aşağıda) — ilk `prisma migrate dev` çalıştırıldıktan SONRA, ilk SUPER_ADMIN'i oluşturmak için.

**Not (ADR 0014 sonrası — faturalama epiği):** Şema yine genişledi (`WorkOrderItem`
kalem alanları, `InvoiceStatus` yeniden tanımlandı, `Invoice.{invoiceNumber,issuedAt,
voidedAt}`, `InvoiceLine` kalem alanları, yeni `InvoiceCounter` + `InvoiceStatusAuditLog`
modelleri — bkz. `docs/adr/0014-invoice-billing-epic.md`). Aynı gerekçeyle (henüz hiç
migration yok) bunlar da adım 4'teki `prisma migrate dev --name init`'e otomatik dahil
olacak — ayrı bir migration adımı GEREKMİYOR.

**Not (CI bağımlılığı):** `.github/workflows/main.yml`'deki `integration-tests` ve
`e2e-tests` job'ları `prisma migrate deploy` çalıştırır — bu komut yalnızca commit'lenmiş
`apps/api/prisma/migrations/` dizinindeki dosyaları uygular, **yeni migration üretmez**.
Yukarıdaki adım 4-5 bu makinede tamamlanıp `prisma/migrations/` commit'lenene kadar bu iki
CI job'ı boş bir şemaya karşı çalışıp kırmızı kalacaktır — bu geçici ve beklenen bir
durumdur, CI kurulumundaki bir hata değildir.

## Not: fiilen kullanılan kurulum "portable" zip'tir, servis DEĞİL

Aşağıdaki adım 1 winget ile **servis olarak** kurulumu anlatıyor, ama bu
makinede (yönetici/UAC erişimi olmadığı için) bunun yerine EnterpriseDB'nin
"portable" zip dağıtımı kullanıldı — Windows servisi kaydetmez, `pg_ctl` ile
elle başlatılıp durdurulur:

```powershell
# %USERPROFILE%\pgportable\pgsql  -> zip'ten çıkarılan binary'ler
# %USERPROFILE%\pgportable\data   -> initdb ile oluşturulan veri dizini
& "$env:USERPROFILE\pgportable\pgsql\bin\initdb.exe" -D "$env:USERPROFILE\pgportable\data" -U postgres --pwfile="$env:USERPROFILE\pgportable\pwfile"
& "$env:USERPROFILE\pgportable\pgsql\bin\pg_ctl.exe" -D "$env:USERPROFILE\pgportable\data" -l "$env:USERPROFILE\pgportable\pg.log" start
```

Bu makinede zaten kurulu ve veritabanları oluşturulmuş durumda — adım 1-2'yi
tekrar çalıştırmanıza gerek yok. Makine her yeniden başladığında (servis
olmadığı için) PostgreSQL ve MinIO'yu elle başlatmanız gerekiyor — bunun için
bkz. aşağıdaki **"Tek komutla ayağa kaldırma"** bölümü.

## Tek komutla ayağa kaldırma: `scripts/dev-up.ps1`

Makine yeniden başladığında (veya PostgreSQL/MinIO herhangi bir sebeple
kapandığında) ikisini de tek komutla ayağa kaldırır — zaten ayaktaysa
dokunmaz (idempotent), eksikse `arac_yazilim`/`arac_yazilim_test`
veritabanlarını ve `arac-yazilim-ecu-files` MinIO bucket'ını da oluşturur:

```powershell
.\scripts\dev-up.ps1
```

Durdurmak için:

```powershell
.\scripts\dev-up.ps1 -Stop
```

Script, `%USERPROFILE%\pgportable` altındaki portable PostgreSQL'i ve
winget ile kurulu `minio.exe`/`mc.exe`'yi (bkz. `docs/local-minio-setup.md`)
sabit yollarla/portlarla varsayar — bu makinedeki mevcut kuruluma göre
yazıldı, başka bir makineye taşınırsa yollar güncellenmeli.

## 1. PostgreSQL 16'yı kurun

PowerShell'i **yönetici olarak** açıp:

```powershell
winget install --id PostgreSQL.PostgreSQL.16 --accept-package-agreements --accept-source-agreements
```

Kurulum sihirbazı superuser (`postgres`) şifresini soracak — `apps/api/.env`
dosyasındaki `devlocal_pg_2026` yerine kendi şifrenizi kullanabilirsiniz, ama
o zaman `.env`'i de güncelleyin. Varsayılan port `5432`.

Kurulum bitince servisin çalıştığını doğrulayın:

```powershell
Get-Service postgresql-x64-16
```

## 2. Uygulama ve test veritabanlarını oluşturun

`psql` kurulum dizinine eklenir (genelde `C:\Program Files\PostgreSQL\16\bin`).
İki ayrı veritabanı gerekiyor — biri uygulama için, biri entegrasyon testleri
için (testler `TRUNCATE ... CASCADE` çalıştırır, uygulama verisiyle asla
karışmamalı, bkz. `apps/api/src/testUtils/integrationDb.ts`):

```powershell
$env:PGPASSWORD = "devlocal_pg_2026"
& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres -h localhost arac_yazilim
& "C:\Program Files\PostgreSQL\16\bin\createdb.exe" -U postgres -h localhost arac_yazilim_test
```

## 3. `.env`'i doğrulayın

`apps/api/.env` zaten bu kuruluma göre önceden dolduruldu:

```
DATABASE_URL="postgresql://postgres:devlocal_pg_2026@localhost:5432/arac_yazilim?schema=public"
DATABASE_URL_TEST="postgresql://postgres:devlocal_pg_2026@localhost:5432/arac_yazilim_test?schema=public"
```

Farklı bir şifre/port kullandıysanız burayı güncelleyin.

## 4. İlk gerçek migration'ı üretin

`schema.prisma` zaten `EcuFile(tenantId, vehicleId, checksum)` unique index'ini
içeriyor (bkz. ADR 0007) — bu adım onu gerçek migration SQL'ine çevirir:

```powershell
cd apps/api
npx prisma migrate dev --name init
```

## 5. `CHECK (creditBalanceKurus >= 0)` kısıtını ekleyin

Prisma şema DSL'i keyfi CHECK constraint'leri ifade edemiyor (bkz. ADR 0005,
ADR 0007) — boş bir migration oluşturup elle SQL eklenmesi gerekiyor:

```powershell
npx prisma migrate dev --create-only --name add_dealer_account_credit_balance_check
```

Oluşan `prisma/migrations/<timestamp>_add_dealer_account_credit_balance_check/migration.sql`
dosyasının içeriğini şu satırla değiştirin:

```sql
ALTER TABLE "DealerAccount"
  ADD CONSTRAINT "DealerAccount_creditBalanceKurus_check" CHECK ("creditBalanceKurus" >= 0);
```

Sonra migration'ı uygulayın:

```powershell
npx prisma migrate dev
```

## 5.5 İlk SUPER_ADMIN'i oluşturun (ADR 0010)

Kayıt/davet HTTP endpoint'leri kasıtlı olarak "kendi kendini yetkilendiremiyor"
— ilk platform-admin'i deploy-time bir script oluşturur (idempotent, güvenle
tekrar çalıştırılabilir):

```powershell
# apps/api/.env'deki PLATFORM_ADMIN_EMAIL/PLATFORM_ADMIN_INITIAL_PASSWORD kullanılır
npm run bootstrap:platform-admin
```

Ardından `tenantSlug="__platform__"` ile `/auth/login`'e giriş yapabilirsiniz
(apps/web'de normal giriş formu, atölye alanına `__platform__` yazılır).

## 6. Doğrulama

```powershell
npm test               # fake/mock birim testleri — DB gerektirmez, değişmemeli
npm run test:integration   # gerçek PostgreSQL'e karşı, yarış koşulu testleri dahil
```

`test:integration` içindeki `fileRequestFulfillment.integration.test.ts` ve
`ecuFileUpload.integration.test.ts`, sırasıyla ADR 0007'deki `SELECT ... FOR
UPDATE` kilidini ve `EcuFile` unique index'ini gerçek eşzamanlı çağrılarla
doğrular. Her iki dosya da her testten önce `resetTestDatabase()` ile
`arac_yazilim_test`'i temizler — `arac_yazilim`'e (uygulama DB'si) hiç
dokunmaz.

## 7. Faz 1 frontend e2e testlerini çalıştırın (apps/web)

`apps/web`'in 3 kritik Playwright senaryosu (`e2e/auth-workorder.spec.ts`,
`e2e/ecu-file.spec.ts`, `e2e/dealer-fulfill.spec.ts`) gerçek bir PostgreSQL +
MinIO gerektirir — bu ajan oturumunda çalıştırılamadı, aşağıdaki adımlar
tamamlandıktan sonra siz çalıştırın:

1. Bu dosyadaki 1-6. adımlar tamamlanmış olmalı (`arac_yazilim_test` DB'si
   migrate edilmiş).
2. MinIO ayakta olmalı (bkz. `docs/local-minio-setup.md`) ve
   `apps/api/.env`'deki `S3_*` değişkenleri doğru olmalı.
3. `apps/web/.env.local.example`'ı `apps/web/.env.local` olarak kopyalayın
   (`NEXT_PUBLIC_API_URL`).
4. `apps/api`'de sunucuyu başlatın: `npm run dev` (ayrı bir terminalde, ayakta
   kalmalı).
5. `apps/web`'de: `npm run test:e2e` — Playwright'in `globalSetup`'ı
   (`e2e/global-setup.ts`) otomatik olarak `npm run seed:e2e -w apps/api`
   çalıştırıp sabit fixture verisini (`e2e-hub`/`e2e-dealer` tenant'ları,
   test kullanıcıları, araç, stock ECU dosyası, dealer kredi hesabı)
   `arac_yazilim_test`'e yazar, sonra 3 senaryoyu gerçek tarayıcıda çalıştırır.

`npx playwright test --list` (DB gerektirmez) bu oturumda çalıştırıldı ve 3
senaryonun da doğru şekilde keşfedildiği doğrulandı — yalnızca gerçek
çalıştırma (fixture seed + tarayıcı etkileşimi) doğrulanamadı.

## Notlar

- `prisma migrate dev` çalıştırıldığında Prisma bir "shadow database"
  kullanır (varsayılan olarak otomatik oluşturup siler) — bu yüzden
  `postgres` kullanıcısının veritabanı oluşturma yetkisi olmalı (superuser
  zaten bu yetkiye sahip).
- CLAUDE.md kuralı gereği `prisma db push` **hiçbir zaman** kullanılmamalı —
  yalnızca `prisma migrate dev`.
