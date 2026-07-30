# ADR 0010 — Platform-Admin Kimlik Modeli (SUPER_ADMIN + Placeholder Platform Tenant)

**Karar:** `Role` enum'una `SUPER_ADMIN` eklendi. `User.tenantId` **NOT NULL kalır** — SUPER_ADMIN kullanıcıları, sabit/rezerve bir slug'a (`PLATFORM_TENANT_SLUG = "__platform__"`, bkz. `apps/api/src/modules/admin/platformTenant.ts`) sahip placeholder bir `Tenant` satırına bağlanır. `Tenant`'a yeni bir kolon (`kind`/`type` ayrımı) eklenmedi — platform tenant'ı yalnızca bu sabit slug'la tanınır.

**Gerekçe (Seçenek A — `tenantId` nullable — neden reddedildi):** `User.tenantId` nullable yapmak `@@unique([tenantId, email])`, `AccessTokenPayload.tenantId: string`, `authPreHandler`, `createTenantScopedDb`/`applyTenantScope`, `authLogin.service.ts`, `authRefresh.service.ts` gibi zaten sertleştirilmiş ve test edilmiş güvenlik-kritik dosyaların tümünü değiştirmeyi gerektirirdi — CLAUDE.md'nin "küçük ve dar kapsamlı görevlerle ilerle" kuralına aykırı, gereksiz büyük bir blast radius.

**Gerekçe (Seçenek B — seçilen):** `applyTenantScope` çalışma zamanında tek bir `tenantId`'yi zorunlu kılıyor ve uyuşmazlıkta `CrossTenantAccessError` fırlatıyor. Bu, admin route'larının `request.tenantDb` kullanmasını yapısal olarak engelliyor (yanlışlıkla kullanılırsa route çöker, sessizce yanlış veri sızdırmaz) — admin route'ları bunun yerine ham `prisma.*` + `requireRole(request, reply, [Role.SUPER_ADMIN])` kullanır. Bu, `DealerAccount`/`FileRequest` modellerinin ADR 0006'dan beri izlediği "iki/sıfır-tenant model → ham prisma + elle yetkilendirme" deseninin aynısı — yeni bir kategori kod değil.

**Kısıt:** `POST /auth/login` değişmedi — SUPER_ADMIN aynı endpoint'i `tenantSlug: "__platform__"` ile kullanır, ayrı bir admin-login yolu yok.

**Kısıt:** İlk SUPER_ADMIN + platform Tenant, bir HTTP endpoint'i ile değil (kendi kendini yetkilendirme paradoksu — bir SUPER_ADMIN'i yaratmak için zaten bir SUPER_ADMIN gerekirdi), deploy-time idempotent bir script ile (`apps/api/scripts/bootstrapPlatformAdmin.ts`, `PLATFORM_ADMIN_EMAIL`/`PLATFORM_ADMIN_INITIAL_PASSWORD` env değişkenlerinden) oluşturulur.

**Durum:** Şema eklendi (yalnızca enum genişlemesi, yeni model/kolon yok). Gerçek DB henüz yok (bkz. `docs/local-postgres-setup.md`) — ilk `prisma migrate dev` çalıştırıldığında bu enum değişikliği de migration'a dahil olacak.
