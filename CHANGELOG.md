# Changelog

## [0.2.0](https://github.com/berkayumutklnc/arac_yazilimi/compare/arac-yazilim-v0.1.0...arac-yazilim-v0.2.0) (2026-08-03)


### Features

* **api:** ecu dosya, bayi ve iş emri route/servis katmanları ([d3c2f14](https://github.com/berkayumutklnc/arac_yazilimi/commit/d3c2f14191ef3129de8f8aa961b6aaed32c78d87))
* **auth:** jwt + refresh token kimlik doğrulama, tenant-scoped prisma middleware ([e4cb4ab](https://github.com/berkayumutklnc/arac_yazilimi/commit/e4cb4ab02bca8383db89f414261abc33583c6a71))
* **diag:** apps/diag-service istemcisi ve iş emri diagnostik rapor akışı (ADR 0009) ([771c492](https://github.com/berkayumutklnc/arac_yazilimi/commit/771c4922b7962fac78f1a5a8fdbbf485b22a62b9))
* platform-admin, davet, bayi bağlama, faturalama epikleri ve üretim dağıtım altyapısı ([be91513](https://github.com/berkayumutklnc/arac_yazilimi/commit/be91513a7d13f6da6123290b878cf159c4dfd7b3))
* **scripts:** portable PostgreSQL + MinIO'yu tek komutla ayağa kaldıran dev-up.ps1 ([8ca1c24](https://github.com/berkayumutklnc/arac_yazilimi/commit/8ca1c24417e47c8fa58f767b09c13a3c025b7790))
* **storage:** s3 uyumlu ECU dosya deposu adaptörü ve entegrasyon test altyapısı ([dfb2a4b](https://github.com/berkayumutklnc/arac_yazilimi/commit/dfb2a4b2626cdd22e58ae9f2460bb74bf52ab3f2))
* **web:** kimlik doğrulama, iş emri ve bayi arayüzü (Next.js) + e2e senaryoları ([f6777e0](https://github.com/berkayumutklnc/arac_yazilimi/commit/f6777e0cf8aa39e5d9b004c3930205579c486c14))


### Bug Fixes

* **ci:** .nvmrc'yi lint-staged'in gerçek Node gereksinimine yükselt ([0618f9c](https://github.com/berkayumutklnc/arac_yazilimi/commit/0618f9ceeeafbb5f903630b8dd9c960ceabf41c2))
* **ci:** bitnami/minio:latest Docker Hub'dan kaldırıldı, bitnamilegacy'ye sabit sürümle geç ([e3d51d7](https://github.com/berkayumutklnc/arac_yazilimi/commit/e3d51d7bdb5e0e4150ebcb9b7f7fed19c44078d1))
* **ci:** checks/main workflow'larına eksik prisma generate + diag-types adımlarını ekle ([e8e86b4](https://github.com/berkayumutklnc/arac_yazilimi/commit/e8e86b4218d1ba08e869962b3392b5fdaac3e1f5))
* **ci:** e2e-tests job'unda PORT env'i job seviyesinden API adımına daralt ([aa97484](https://github.com/berkayumutklnc/arac_yazilimi/commit/aa97484e370a52e9c13464cd5bde39d186e38de4))
* **ci:** npm ci yerine geçici olarak npm install kullan (lockfile linux'ta eksik) ([4ee9cd3](https://github.com/berkayumutklnc/arac_yazilimi/commit/4ee9cd3c18f6729ba3f357047d14c6eb06646219))
* **ci:** npm install öncesi lockfile'ı sil — Linux'ta eksik optional dep'leri gerçekten çöz ([f898237](https://github.com/berkayumutklnc/arac_yazilimi/commit/f8982376600b4d9a6f80575a399c2e51e693a591))
* **ci:** npm-audit job'ını audit-ci + gerekçeli istisna listesine geçir ([7a5ce40](https://github.com/berkayumutklnc/arac_yazilimi/commit/7a5ce402f5c240f943d0ec291dc824d8d5adee2b))
* **ci:** workflow tetikleyicilerini repo'nun gerçek dalı master'a düzelt ([8e2c0fe](https://github.com/berkayumutklnc/arac_yazilimi/commit/8e2c0feaddb7aeb7e0ba9b7b9617cdfdfb4e7f14))
* **dealer:** gerçek Postgres+MinIO doğrulamasında bulunan cross-tenant hataları düzelt ([dc619df](https://github.com/berkayumutklnc/arac_yazilimi/commit/dc619df3bb258485bd00ed72bfb316bac8ab6aa9))
* **security:** enforce vehicle-tenant ownership in dealer file requests ([e1e3033](https://github.com/berkayumutklnc/arac_yazilimi/commit/e1e3033c445ea4412b2068d8a323fe1672aae475))
* **security:** enforce vehicle-tenant ownership in EcuFile creation ([405bfa1](https://github.com/berkayumutklnc/arac_yazilimi/commit/405bfa1e0c9c3dfd899fc188eb038dc1690110be))
* **security:** require tenant scoping in work order compliance service ([358bd11](https://github.com/berkayumutklnc/arac_yazilimi/commit/358bd11cb96072894c3a10da430291c0b5c73a4a))
* **security:** sanitize file name before use in ECU upload storage key ([eaac163](https://github.com/berkayumutklnc/arac_yazilimi/commit/eaac163b34e4dc59b29aaac320e652575bbd8f8f))
