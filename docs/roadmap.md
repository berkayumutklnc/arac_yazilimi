# Roadmap — Faz 1 (MVP, 0-3 ay)

Kapsam: iş emri + müşteri + araç + ECU dosya arşivi + faturalama.

Her story'nin "Definition of Done"ı: önce başarısız test → kod (TDD), zod ile girdi
doğrulama, tenant_id middleware üzerinden erişim, `npm run test` + `npm run lint` geçer.

## Epic 0 — Platform Altyapısı (ön koşul)
Amaç: diğer tüm epiclerin üzerine kurulacağı temel (auth, tenant, roller).
- US-0.1: Owner olarak kendi atölyem için bir tenant kaydı oluşturabilmeliyim.
  - T-0.1.1: Tenant Prisma modeli + migration
  - T-0.1.2: Tenant oluşturma endpoint'i (zod input şeması + test)
- US-0.2: Kullanıcı olarak rolüme göre (owner/engineer/receptionist/dealer) giriş yapabilmeliyim.
  - T-0.2.1: User modeli + JWT + refresh token akışı
  - T-0.2.2: Rol tabanlı route guard middleware + test
- US-0.3: Sistem olarak her sorguda tenant_id filtresinin otomatik uygulanmasını garanti etmeliyim.
  - T-0.3.1: Prisma middleware (tenant_id enjeksiyonu) + izolasyon testi (cross-tenant sızıntı testi)

## Epic 1 — Müşteri (CRM)
Amaç: müşteri kayıtlarının KVKK'ya uygun şekilde tutulması.
- US-1.1: Receptionist olarak yeni müşteri kaydı oluşturabilmeliyim.
  - T-1.1.1: Customer Prisma modeli (tenant_id dahil) + migration
  - T-1.1.2: Create-customer endpoint (zod şema: ad, telefon, TC — TC hash'lenmiş/maskeli saklanır)
  - T-1.1.3: Loglama katmanında PII redaksiyon testi (telefon/TC log'a yazılmıyor)
- US-1.2: Receptionist olarak müşteri arayabilmeli ve geçmişini görebilmeliyim.
  - T-1.2.1: List/search endpoint (sayfalama, tenant filtreli)
- US-1.3: Müşteri olarak (KVKK) verimin silinmesini talep edebilmeliyim.
  - T-1.3.1: Soft-delete + anonimleştirme akışı, uçtan uca sil testi

## Epic 2 — Araç
Amaç: araç geçmişinin müşteri ve iş emirlerine bağlanması.
- US-2.1: Receptionist olarak müşteriye ait araç kaydı ekleyebilmeliyim.
  - T-2.1.1: Vehicle Prisma modeli (plaka, şasi/VIN, marka/model/yıl, customerId, tenant_id)
  - T-2.1.2: Create-vehicle endpoint + zod şema + test
  - T-2.1.3: Plaka alanının loglanmadığını doğrulayan test (KVKK)
- US-2.2: Engineer olarak bir aracın geçmiş iş emirlerini görebilmeliyim.
  - T-2.2.1: Vehicle detail endpoint (ilişkili work order listesi)

## Epic 3 — İş Emri
Amaç: atölye iş akışının merkezi; AİTM tadilat tescili otomasyonu.
- US-3.1: Engineer olarak bir araç için iş emri açabilmeliyim.
  - T-3.1.1: WorkOrder Prisma modeli + status enum + migration
  - T-3.1.2: Create-work-order endpoint + zod şema + test
- US-3.2: Engineer olarak iş emrine hizmet/işlem kalemleri ekleyebilmeliyim.
  - T-3.2.1: ServiceType tanımı (motor gücünü etkiler mi bayrağı ile) + WorkOrderItem modeli
  - T-3.2.2: Add-item endpoint + test
- US-3.3: Sistem olarak motor gücünü değiştiren bir kalem eklendiğinde AİTM bayrağını
  ve TSE/TÜVTÜRK süreç adımlarını otomatik açmalıyım.
  - T-3.3.1: AitmProcessStep modeli + otomatik oluşturma tetikleyicisi
  - T-3.3.2: "affectsEnginePower=true kalem eklenince aitmRegistrationRequired=true olur" testi
- US-3.4: Engineer olarak iş emrini kapatabilmeliyim (kapanış koşulları: fatura + varsa AİTM adımları).
  - T-3.4.1: Close-work-order endpoint + iş kuralı doğrulama + test

## Epic 4 — ECU Dosya Arşivi
Amaç: her yazma işleminde orijinal yedek referansı zorunlu; dosyalar S3'te, DB'de sadece metadata.
- US-4.1: Engineer olarak bir aracın orijinal (stock) ECU dosyasını arşive yükleyebilmeliyim.
  - T-4.1.1: EcuFile Prisma modeli (fileType=ORIGINAL_STOCK, storageKey, checksum)
  - T-4.1.2: S3 pre-signed upload akışı + metadata create endpoint + test
- US-4.2: Engineer olarak bir stage dosyası yazma işlemini, zorunlu olarak orijinal
  dosyaya referans vererek kaydedebilmeliyim.
  - T-4.2.1: EcuWriteOperation modeli (originalFileId NOT NULL FK) + migration
  - T-4.2.2: Create-write-operation endpoint: originalFileId eksikse 400 + test
  - T-4.2.3: "yedeksiz kayıt oluşturulamaz" iş kuralı testi (DB constraint + zod)
- US-4.3: Engineer olarak bir aracın tüm ECU dosya/işlem geçmişini görebilmeliyim.
  - T-4.3.1: Vehicle → EcuFile/EcuWriteOperation timeline endpoint

## Epic 5 — Faturalama
Amaç: iş emrinden faturaya; tüm tutarlar kuruş cinsinden integer.
- US-5.1: Receptionist olarak kapanmış bir iş emrinden fatura oluşturabilmeliyim.
  - T-5.1.1: Invoice + InvoiceLine Prisma modeli (amountKurus: Int)
  - T-5.1.2: Generate-invoice-from-work-order endpoint + test (float kullanılmadığı doğrulanır)
- US-5.2: Receptionist olarak faturaya ödeme kaydedebilmeliyim.
  - T-5.2.1: Payment modeli + kısmi ödeme desteği + test
- US-5.3: Owner olarak dönemsel ciro/tahsilat raporunu görebilmeliyim (temel).
  - T-5.3.1: Basit toplam rapor endpoint'i (tenant filtreli)

## Sıralama önerisi
Epic 0 → Epic 1 → Epic 2 → Epic 3 → Epic 4 → Epic 5
(Her epic tek PR/tek domain kuralına uyacak şekilde story bazında küçük PR'lara bölünür.)
