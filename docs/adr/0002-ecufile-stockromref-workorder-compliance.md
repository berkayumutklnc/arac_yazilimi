# ADR 0002 — EcuFile.stockRomRef ve WorkOrderComplianceStep

**Karar:** `EcuWriteOperation` modeli kaldırıldı; onun yerine `EcuFile.stockRomRef` (NOT NULL, self-relation FK → `EcuFile.id`) eklendi. `AitmProcessStep` → `WorkOrderComplianceStep`, `WorkOrder.aitmRegistrationRequired` → `WorkOrder.requiresAitmRegistration` olarak yeniden adlandırıldı.
**Gerekçe:** Her ECU dosya kaydının (orijinal dahil) doğrudan bir stock referansı taşıması, ayrı bir "yazma işlemi" tablosuna göre daha basit ve tek sorguda doğrulanabilir; orijinal stock dosyası kendi id'sine referans verir (self-pointer), stage/custom dosyalar ise gerçek orijinali işaret etmek zorundadır.
**Kısıt:** `stockRomRef` DB seviyesinde NOT NULL + FK — stage dosyası stock referansı olmadan asla insert edilemez.
**Kısıt:** `requiresAitmRegistration=true` olduğunda `WorkOrderComplianceStep` kayıtları servis katmanında otomatik ve idempotent oluşturulur (TSE ön başvuru, TÜVTÜRK tescil).
**Durum:** Taslak — gerçek Postgres bağlantısı olmadığı için DB constraint'i `prisma validate`/`generate` ile ve servis katmanı Vitest testleriyle doğrulanıyor; `prisma migrate dev` ilk gerçek DB'ye bağlanıldığında çalıştırılacak.
