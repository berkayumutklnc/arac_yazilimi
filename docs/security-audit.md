# Güvenlik Denetimi — Faz 1 Kod Tabanı

**Tarih:** 2026-07-27
**Kapsam:** `apps/api` (Fastify/Prisma), `apps/diag-service` (FastAPI), `packages/shared`
**Metodoloji:** Manuel kod incelemesi (OWASP Top 10 perspektifi: injection, broken access control/tenant sızıntısı, IDOR, dosya yükleme) + her tenant izolasyon noktası için otomatik "kötü niyetli komşu tenant" regresyon testi + KVKK loglama taraması.
**Test kanıtı:** `apps/api/src/security/tenantIsolation.security.test.ts` (7 senaryo) + ilgili modül testleri. Her kritik/yüksek bulgu önce kırmızı (zafiyet ampirik olarak tetiklendi) gösterildi, sonra yamalandı ve yeşile çevrildi — commit geçmişi bu sırayı yansıtıyor.

## Yönetici Özeti

| # | Bulgu | Önem | Durum |
|---|---|---|---|
| KRİTİK-0 | Auth/oturum katmanı yok — `tenantId` istek gövdesinden alınıyor | **Kritik** | **Yamalanmadı** — Epic 0'a bağlı, bkz. aşağıda |
| KRİTİK-1 | `createEcuFile` araç sahipliğini doğrulamıyordu | **Kritik** | ✅ Yamalandı |
| KRİTİK-2 | `createFileRequest` araç sahipliğini doğrulamıyordu | **Kritik** | ✅ Yamalandı |
| KRİTİK-3 | `applyServiceTypeToWorkOrder` hiç tenant filtresi kullanmıyordu | **Kritik** | ✅ Yamalandı |
| YÜKSEK-1 | ECU upload storage key'inde dosya adı sanitize edilmiyordu | Yüksek | ✅ Yamalandı |
| ORTA-1 | `diag-service`'de kimlik doğrulama yok | Orta | Belgelendi, yamalanmadı |
| ORTA-2 | Fastify `logger:false` kasıtlı bir KVKK kararı olarak belgelenmemişti | Orta | Belgelendi (bu raporla belgelendi) |
| ORTA-3 | `checksum` alanı SHA-256 formatı olarak doğrulanmıyor | Orta | Belgelendi, yamalanmadı |
| DÜŞÜK-1 | String alanlarda `.max()` yok (kaynak tüketimi riski) | Düşük | Belgelendi |
| DÜŞÜK-2 | `diag-service` dosyaları tamamen belleğe okuyor (stream yok) | Düşük | Belgelendi |
| DÜŞÜK-3 | Reddedilen indirme denemeleri audit loglanmıyor | Düşük | Belgelendi |
| DÜŞÜK-4 | `readFileId` talep açılışında erken doğrulanmıyor | Düşük | Belgelendi |
| KVKK | Kişisel veri (plaka/TC/telefon) loglara sızıyor mu? | — | **Doğrulandı: sızmıyor** (aşağıda detay) |

---

## KRİTİK-0 — Kimlik doğrulama/oturum katmanı yok (Broken Authentication)

**Konum:** `apps/api/src/modules/workorder/workOrder.routes.ts` (tek gerçek HTTP endpoint'i), dolayısıyla ileride eklenecek her route.
**Sorun:** Epic 0 (auth/tenant middleware) henüz kurulmadığı için `PATCH /work-orders/:id/status` `tenantId`'yi doğrudan istek gövdesinden okuyor:
```ts
const bodySchema = z.object({ tenantId: z.string().min(1), toStatus: ..., changedBy: ... });
```
Servis katmanındaki tüm `tenant_id` filtreleri (`findUnique({id, tenantId})`) doğru çalışıyor — ama saldırgan hedef tenant'ın id'sini zaten biliyorsa (ya da tahmin ediyorsa) `tenantId` alanına doğrudan onu yazıp "kendi" isteğiymiş gibi gönderebilir. Bu, kod seviyesindeki tenant izolasyonunu tamamen anlamsız kılar — izolasyon kontrolleri doğru ama *girdi* güvenilmiyor.
**Etki:** Herhangi bir çağıran, herhangi bir tenant'ın iş emrini (ve Epic 0 sonrası eklenecek her endpoint'i) görebilir/değiştirebilir.
**Neden yamalanmadı:** Gerçek düzeltme (JWT/refresh token + oturumdan tenantId/role okuma) CLAUDE.md'nin kendi yol haritasında ayrı bir epik (Epic 0) — bu denetim turunda yüzeysel bir "düzeltme" (ör. body'deki alanı gizlice yok saymak) gerçek bir çözüm olmaz, yanlış güvenlik hissi verir. Bunun yerine risk maksimum görünürlükte burada kayda geçiriliyor.
**Öneri:** Epic 0 tamamlanana kadar bu API'yi internete açmayın (yalnızca dahili/güvenilir ağda). Epic 0'da: `tenantId`/`role`/`userId` yalnızca doğrulanmış JWT claim'lerinden okunmalı, hiçbir route body/query'den tenantId kabul etmemeli.

---

## KRİTİK-1 — `createEcuFile` araç sahipliğini doğrulamıyordu ✅ Yamalandı

**Konum:** `apps/api/src/modules/ecufile/ecuFile.service.ts`
**Sorun (OWASP: Broken Access Control / IDOR):** `createEcuFile`, `input.vehicleId`'nin gerçekten `input.tenantId`'ye ait olduğunu hiçbir zaman doğrulamıyordu — `Vehicle` tablosuna hiç sorgu atmıyordu. Tenant A, Tenant B'nin `vehicleId`'sini vererek (kendi `tenantId`'siyle) B'nin aracına bir `ORIGINAL_STOCK` dosya kaydı iliştirebiliyordu. Bu zafiyet `confirmEcuFileUpload` ve `fulfillFileRequest`'e de `createEcuFile` üzerinden sızıyordu (üç çağrı noktası, tek kök neden).
**Kanıt:** `tenantIsolation.security.test.ts` → "EcuFile oluşturma: Tenant B, kendi tenantId'siyle Tenant A'nın aracına dosya kaydı iliştiremez" — yama öncesi `create` sessizce başarılı oluyordu (kırmızı: *"promise resolved undefined instead of rejecting"*).
**Yama:** `createEcuFile` artık ilk adımda `db.vehicle.findUnique({id, tenantId})` ile sahipliği doğruluyor; yoksa `VehicleNotFoundError`.
**Commit:** `fix(security): enforce vehicle-tenant ownership in EcuFile creation`

## KRİTİK-2 — `createFileRequest` araç sahipliğini doğrulamıyordu ✅ Yamalandı

**Konum:** `apps/api/src/modules/dealer/fileRequest.service.ts`
**Sorun:** Aynı desen — kötü niyetli bir `DEALER`, başka bir tenant'ın `vehicleId`'sini vererek hub'a dosya talebi açabiliyordu. `readFileId`'nin tutarlılığı `fulfillFileRequest` anında `createEcuFile`'ın `stockRomRef` kontrolüyle dolaylı olarak yakalanıyordu, ama `vehicleId`'nin kendisi hiç doğrulanmıyordu ve istek `ACCEPTED` aşamasına kadar (hub gereksiz yere fiyat/emek harcayana kadar) sorunsuz ilerleyebiliyordu.
**Kanıt:** `tenantIsolation.security.test.ts` → "FileRequest oluşturma: kötü niyetli bir DEALER, Tenant A'nın aracı için hub'a talep açamaz".
**Yama:** `createFileRequest`, `dealerAccount` aramasından önce `db.vehicle.findUnique({id, tenantId: dealerTenantId})` ile doğruluyor; yoksa `VehicleNotFoundError`.
**Commit:** `fix(security): enforce vehicle-tenant ownership in dealer file requests`

## KRİTİK-3 — `applyServiceTypeToWorkOrder` hiç tenant filtresi kullanmıyordu ✅ Yamalandı

**Konum:** `apps/api/src/modules/workorder/workOrderCompliance.service.ts`
**Sorun:** CLAUDE.md kural 5'in ("her sorguda tenant_id filtresi... asla elle atlanmaz") doğrudan ihlali. Fonksiyon `workOrderId: string` alıp doğrudan `db.workOrder.update({where:{id}}, ...)` çağırıyordu — **hiçbir** tenant kontrolü yoktu. Tahmin edilebilir/sızdırılmış bir `workOrderId` ile herhangi bir çağıran başka bir tenant'ın `requiresAitmRegistration` alanını değiştirip sahte `WorkOrderComplianceStep` kayıtları oluşturabilirdi.
**Kanıt:** `tenantIsolation.security.test.ts` → "WorkOrderCompliance: Tenant B, Tenant A'nın iş emrinin id'sini tahmin edip AİTM alanlarını değiştiremez" — yama öncesi `db.workOrder.findUnique` hiç çağrılmıyordu (fonksiyonda bu dependency bile yoktu).
**Yama:** İmza `workOrderId: string` → `{workOrderId, tenantId}` olarak değişti; `workOrderTransition.service.ts`'deki yerleşik desenle aynı şekilde önce tenant-scoped `findUnique` ile sahiplik doğrulanıyor, yoksa (aynı modülden reuse edilen) `WorkOrderNotFoundError`.
**Commit:** `fix(security): require tenant scoping in work order compliance service`

## YÜKSEK-1 — ECU upload storage key'inde dosya adı sanitize edilmiyordu ✅ Yamalandı

**Konum:** `apps/api/src/modules/ecufile/ecuFileUpload.service.ts` (`requestEcuFileUpload`)
**Sorun (OWASP: dosya yükleme / path traversal):** İstemciden gelen `fileName`, storage key'e (`${tenantId}/${vehicleId}/${uuid}-${fileName}`) sanitize edilmeden ekleniyordu. `"../../../etc/passwd"` gibi bir dosya adı, öngörülen `tenantId/vehicleId` önekinin dışına taşan bir anahtar üretebiliyordu. Saf S3'te etki sınırlı (S3 anahtarları düz string, gerçek path resolution yok) ama dosya sistemi tabanlı bir storage adaptörüne geçildiğinde gerçek path traversal riski taşıyor; ayrıca S3 anahtar enjeksiyonu/operasyonel bozulma riski.
**Kanıt:** `ecuFileUpload.service.test.ts` → "dosya adındaki path traversal / ayraç karakterleri storage key'e sanitize edilmeden geçmez".
**Yama:** `sanitizeFileNameForStorageKey()` — `/`, `\` ve `..` dizilerini temizler, yalnızca `[a-zA-Z0-9._-]` karakterlerine izin verir, 200 karaktere kırpar.
**Commit:** `fix(security): sanitize file name before use in ECU upload storage key`

---

## ORTA-1 — `diag-service`'de kimlik doğrulama yok

**Konum:** `apps/diag-service/src/diag_service/*/router.py`
FastAPI endpoint'leri (`/dtc/parse`, `/wot/analyze`) herhangi bir auth/tenant kontrolü içermiyor — CLAUDE.md'ye göre bu servis "yalnızca /diag-service altında" ayrı bir mikroservis, doğrudan son kullanıcıya açık olması beklenmiyor. Ancak bunu zorlayan hiçbir mekanizma (ağ izolasyonu, dahili token) kodda yok.
**Öneri:** Servis yalnızca dahili ağda/servisler-arası olmalı (internete açılmamalı); apps/api'den çağrılırken paylaşılan bir dahili secret/mTLS eklenmesi önerilir. Bu görevde yamalanmadı (altyapı/deploy kararı, kod değişikliği değil).

## ORTA-2 — Fastify `logger:false` kasıtlı bir KVKK kararı olarak belgelenmemişti

**Konum:** `apps/api/src/app.ts`
Şu an `Fastify({ logger: false })` — hiçbir request loglanmıyor, bu yönüyle KVKK açısından güvenli (aşağıdaki KVKK bölümüne bakın) ama bu bir güvenlik kararı olarak belgelenmemiş bir yan etkiydi, bilinçli bir KVKK önlemi değildi. **Öneri:** `logger` ileride açılırsa (`logger: true`), Fastify'ın `redact` seçeneği ile `req.body.phoneHash`, `req.body.nationalIdHash`, `req.body.plate` gibi alanlar (Customer/Vehicle route'ları eklendiğinde) baştan redakte edilmeli — aksi halde varsayılan request logging tüm body'yi loglar.

## ORTA-3 — `checksum` alanı SHA-256 formatı olarak doğrulanmıyor

**Konum:** `apps/api/src/modules/ecufile/ecuFile.service.ts` — `checksum: z.string().min(1)`
Sunucu tarafında yeniden hesaplanan hash (`confirmEcuFileUpload`) doğru değeri kullanıyor, ama şema seviyesinde 64 haneli hex formatı zorlanmıyor. Doğrudan `createEcuFile` çağıran (gelecekteki) bir yol, keyfi bir string'i checksum olarak kaydedebilir. Düşük risk (veri bütünlüğü, exploit değil). **Öneri:** `z.string().regex(/^[a-f0-9]{64}$/i)`.

## DÜŞÜK-1 — String alanlarda `.max()` yok

`fileName`, `checksum`, gelecekteki `fullName`/`description` gibi alanlarda üst sınır yok — potansiyel kaynak tüketimi (büyük payload'larla DoS). Canlı bir sunucu olmadığı için şu an sömürülemez; ileride zod şemalarına `.max()` eklenmesi önerilir.

## DÜŞÜK-2 — `diag-service` dosyaları tamamen belleğe okuyor

`await file.read()` (hem `dtc/router.py` hem `wot/router.py`) dosyayı stream etmeden tamamen belleğe alıyor. Büyük bir log/CSV dosyası bellek tüketimine (DoS) yol açabilir. Streaming'e geçmek daha büyük bir refactor gerektirir, bu turda kapsam dışı bırakıldı.

## DÜŞÜK-3 — Reddedilen indirme denemeleri audit loglanmıyor

`downloadEcuFile`, yalnızca **başarılı** indirmeleri `EcuFileDownloadAuditLog`'a yazıyor (talep edildiği gibi). Yetkisiz rol/tenant denemeleri hiç loglanmıyor — güvenlik izleme açısından bu denemelerin de (ayrı bir "denied access" log'unda) tutulması ileride faydalı olabilir, ama mevcut kapsam ("her indirme audit loglanır") sadece başarılı indirmeleri kastediyordu.

## DÜŞÜK-4 — `readFileId` talep açılışında erken doğrulanmıyor

KRİTİK-2 yaması yalnızca `vehicleId`'yi doğruluyor; `readFileId`'nin `dealerTenantId`+`vehicleId`'ye ait olduğu yalnızca `fulfillFileRequest` anında (`createEcuFile`'ın `stockRomRef` kontrolü üzerinden) doğrulanıyor. Gerçek bir güvenlik açığı değil (fulfillment her zaman güvenli şekilde reddeder) ama geçersiz bir talebin `ACCEPTED`'a kadar ilerleyebilmesi bir UX/defense-in-depth eksikliği. İleride `createFileRequest`'e `ecuFile.findUnique` bağımlılığı eklenerek erken doğrulama yapılabilir.

---

## KVKK Kontrolü — Kişisel Veri Loglara Sızıyor mu?

**Sonuç: Sızmıyor.** Doğrulama adımları:
1. `console.log|console.error|console.warn|console.info|print(` için tüm `apps/api/src` ve `apps/diag-service/src` tarandı — **sıfır** eşleşme (yalnızca `server.ts`'te başlangıç hatası için `app.log.error(err)` var, request/PII verisi içermiyor).
2. Fastify `app.ts`'te `logger: false` — hiçbir HTTP isteği (dolayısıyla hiçbir body/query) loglanmıyor (bkz. ORTA-2 — bu şu an koruyucu ama kasıtsız).
3. `Customer.phoneHash`/`nationalIdHash` şemada zaten **hash'li** tutuluyor (CLAUDE.md kural 6 ile uyumlu tasarım) — ancak Customer servis katmanı henüz yazılmadı, bu yüzden bu alanlara dokunan çalışan kod yok.
4. `Vehicle.plate` şemada düz metin ama Vehicle servis katmanı da henüz yazılmadı — plaka'ya dokunan hiçbir kod yolu yok.
5. Tüm özel hata sınıfları (`WorkOrderNotFoundError`, `EcuFileNotFoundError`, `VehicleNotFoundError` vb.) mesajlarında yalnızca id'ler geçiyor (plaka/TC/telefon değil).

**Önleyici öneri (Customer/Vehicle servisleri yazıldığında geçerli olacak):** `phoneHash`/`nationalIdHash`/`plate` alanlarını içeren hiçbir nesne doğrudan `console.*`/Fastify logger'a geçirilmemeli; Fastify logger açıldığında `redact` listesine eklenmeli. Bu, kod incelemesi/PR checklist'ine madde olarak eklenmesi önerilen bir kural.

---

## Kötü Niyetli Komşu Tenant Test Paketi

`apps/api/src/security/tenantIsolation.security.test.ts` — 7 tenant izolasyon noktasının her biri için:

| İzolasyon noktası | Önceki durum | Test |
|---|---|---|
| `transitionWorkOrderStatus` | Zaten güvenli | ✅ geçti (patch gerekmedi) |
| `downloadEcuFile` | Zaten güvenli | ✅ geçti (patch gerekmedi) |
| `transitionFileRequestStatus` | Zaten güvenli | ✅ geçti (patch gerekmedi) |
| `fulfillFileRequest` | Zaten güvenli | ✅ geçti (patch gerekmedi) |
| `createEcuFile` | **Zafiyetliydi** | 🔴→🟢 KRİTİK-1 yamasıyla düzeldi |
| `createFileRequest` | **Zafiyetliydi** | 🔴→🟢 KRİTİK-2 yamasıyla düzeldi |
| `applyServiceTypeToWorkOrder` | **Zafiyetliydi** | 🔴→🟢 KRİTİK-3 yamasıyla düzeldi |

Ayrıca `ecuFileUpload.service.test.ts`'e YÜKSEK-1 için ayrı bir dosya-adı-sanitizasyon testi eklendi (tenant izolasyonu değil, girdi doğrulama kategorisi olduğu için ayrı tutuldu).

## Enjeksiyon (Injection) Taraması

- **SQL Injection:** Tüm veritabanı erişimi Prisma ORM üzerinden yapılandırılmış `where` nesneleriyle yapılıyor; kod tabanında `$queryRaw`/`$queryRawUnsafe`/`$executeRawUnsafe` kullanımı yok (yalnızca Prisma'nın kendi üretilen tip tanımlarında referans olarak geçiyor). **Bulgu yok.**
- **ReDoS:** `ecuFilePolicy.ts` ve `diag_service/dtc/parser.py`'deki regex'ler basit alternasyon/sınır kalıpları — iç içe quantifier veya catastrophic backtracking riski yok. **Bulgu yok.**
- **Command/Path Injection:** Kod tabanında `exec`/`eval`/`child_process`/`os.system` kullanımı yok. **Bulgu yok.**

## Sonuç ve Öncelik Sırası

1. **Epic 0 (auth/tenant middleware)** bu denetimin gösterdiği en kritik açık — mevcut tüm tenant izolasyonu, doğrulanmamış bir `tenantId` girdisinin üzerine kurulu. Bir sonraki route eklenmeden önce ele alınmalı.
2. Bu turda yamalanan 3 kritik + 1 yüksek bulgu, "vehicle sahipliği hiç doğrulanmıyordu" ortak kök nedenine sahipti — ileride yeni bir `vehicleId` alan bir servis yazılırken bu deseni (önce `vehicle.findUnique({id, tenantId})`) varsayılan olarak uygulamak gerekir.
3. ORTA/DÜŞÜK bulgular acil değil, gelecek sprint'lere not düşüldü.
