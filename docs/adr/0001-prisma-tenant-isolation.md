# ADR 0001 — Prisma İlk Şema ve Tenant İzolasyonu

**Karar:** Çok kiracılı izolasyon satır bazlı `tenantId` ile yapılır; her domain modeli (`Customer`, `Vehicle`, `WorkOrder`, `EcuFile`, `EcuWriteOperation`, `Invoice`...) doğrudan `Tenant`'a FK taşır ve `tenantId` üzerinde index vardır.
**Gerekçe:** Ayrı şema/veritabanı yerine satır bazlı izolasyon seçildi (CLAUDE.md sabit kararı); Prisma middleware ile sorgulara otomatik filtre eklenmesi tek bir yerde denetlenebilir.
**Ek karar:** `EcuWriteOperation.originalFileId` NOT NULL FK olarak tanımlandı — "yedeksiz kayıt oluşturulamaz" kuralı DB seviyesinde garanti edilir.
**Sonuç:** Tenant middleware (Epic 0 / T-0.3.1) uygulanmadan önce hiçbir modül prod'a alınamaz; cross-tenant sızıntı testi zorunlu kabul kriteridir.
**Durum:** Taslak — ilk `prisma migrate dev` çalıştırılmadan (gerçek DATABASE_URL bağlanmadan) önce gözden geçirilecek.
