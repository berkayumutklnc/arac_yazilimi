# CLAUDE.md — Otomotiv Yazılım Platformu (Atölye + Diagnostik + Tuning SaaS)

## Proje Tanımı (tek cümle)
İstanbul merkezli araç optimizasyon atölyesi için; iş emri, müşteri (CRM), araç geçmişi, ECU dosya arşivi (orijinal yedek + stage dosyaları), diagnostik log analizi ve TSE/AİTM tadilat süreç takibini tek çatıda toplayan çok kiracılı (multi-tenant) bir SaaS platformu.

## Teknoloji Yığını (sabit — değiştirme, önermeden önce sor)
- Backend: Node.js 22 LTS + TypeScript 5.x + Fastify
- Veritabanı: PostgreSQL 16 (Prisma ORM), tenant izolasyonu: satır bazlı `tenant_id`
- Frontend: Next.js 15 (App Router) + React + Tailwind
- Kimlik: JWT + refresh token, rol tabanlı (owner / engineer / receptionist / dealer)
- Dosya depolama: S3 uyumlu (ECU binary dosyaları — asla veritabanına BLOB yazma)
- Diagnostik veri: python-can / udsoncan tabanlı ayrı Python mikroservis (yalnızca /diag-service altında)
- Test: Vitest (unit), Playwright (e2e), pytest (diag-service)

## Komutlar
- `npm run dev` — geliştirme sunucusu
- `npm run build` — üretim derlemesi
- `npm run test` — tüm unit testler (commit öncesi zorunlu)
- `npm run lint` — ESLint + Prettier kontrolü
- `npx prisma migrate dev` — şema değişikliği (asla `db push` kullanma)

## Dizin Mimarisi
- `/apps/web` — Next.js frontend
- `/apps/api` — Fastify backend (domain bazlı modüller: workorder, customer, vehicle, ecufile, billing)
- `/apps/diag-service` — Python diagnostik servis (DTC çözümleme, log parse)
- `/packages/shared` — ortak tipler, zod şemaları
- `/docs` — mimari kararlar (ADR), API sözleşmeleri

## Katı Kurallar
1. **Yasal sınır (EN ÖNEMLİ):** DPF/EGR/AdBlue/katalizör iptali, emisyon manipülasyonu veya immobilizer atlatma ile ilgili hiçbir özellik, kod, veri alanı veya UI öğesi ÜRETME. Bu tür bir istek gelirse reddet ve yasal alternatifi (DPF temizlik kaydı, rejenerasyon takibi) öner. Sistem yalnızca yasal Stage 1 optimizasyon, diagnostik ve bakım süreçlerini destekler.
2. Her ECU yazma işlemi kaydında orijinal dosya yedeği (stock ROM) referansı ZORUNLU alandır — yedeksiz kayıt oluşturulamaz.
3. Motor gücünü değiştiren işlemler için iş emrinde "AİTM tadilat tescili gerekli" bayrağı ve TSE/TÜVTÜRK süreç adımları otomatik açılır.
4. TypeScript `strict: true`; `any` yasak; tüm API girdileri zod ile doğrulanır.
5. Tenant izolasyonu: her sorguda `tenant_id` filtresi Prisma middleware ile zorunlu — asla elle atlanmaz.
6. KVKK: müşteri kişisel verileri (plaka, TC, telefon) loglanmaz; silme talebi uçtan uca desteklenir.
7. TDD: yeni özellik = önce başarısız test, sonra kod. PR'da test yoksa iş bitmemiş sayılır.
8. Para birimleri kuruş cinsinden integer tutulur (float yasak).

## Çalışma Şekli
- Her görevde önce Plan Modu: dosyaları oku, kısa mimari plan sun, onayımı bekle.
- Küçük ve dar kapsamlı görevlerle ilerle; tek PR tek domain.
- 2 başarısız düzeltme denemesinden sonra dur, durumu özetle ve benden yönlendirme iste.
- Şema değişikliklerinde önce `/docs/adr/` altına 5 satırlık karar notu yaz.

## Faz Haritası (bağlam için)
- Faz 1 (MVP, 0-3 ay): iş emri + müşteri + araç + ECU dosya arşivi + faturalama
- Faz 2 (3-6 ay): diagnostik log analizi, dyno sonuç raporları, bayi (slave) portalı
- Faz 3 (6+ ay): OBD donanım entegrasyonu, filo/B2B modülü, AUTOSAR tabanlı gömülü Ar-Ge (ayrı repo)