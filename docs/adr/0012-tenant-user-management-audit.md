# ADR 0012 — Kiracı-İçi Kullanıcı Yönetimi (Deaktivasyon + Rol Değişikliği Audit Log)

**Karar:** `User`'a `deactivatedAt DateTime?` eklendi (`Customer.deletedAt`'teki soft-flag deseniyle tutarlı — satır silinmez, işaretlenir). Yeni, tenant-scoped bir `UserManagementAuditLog` modeli eklendi: `tenantId, actorId (FK yok), targetUserId (FK VAR — User), action (ROLE_CHANGED|DEACTIVATED), fromRole (Role?), toRole (Role?), createdAt`. `TENANT_SCOPED_MODELS`'e dahil edildi (`AccessDeniedAuditLog` ile aynı "ayrı model + saf `logX(db,params)` fonksiyonu" deseni, bkz. ADR 0008).

**Gerekçe:** Rol değişikliği ve deaktivasyon, CLAUDE.md'nin denetlenebilirlik beklentisiyle uyumlu olarak audit loglanmalı. `targetUserId` (aksine `AccessDeniedAuditLog.resourceId`'nin FK'siz olmasına) burada bilinçli olarak FK'li — hedef her zaman aynı tenant içindeki gerçek bir `User` satırı, referans bütünlüğü ihlali riski yok.

**Kısıt (anında refresh-token iptali):** `deactivateUser`, aynı transaction içinde `revokeAllRefreshTokensForUser(tx, targetUserId)` çağırır — bu fonksiyon `authRefresh.service.ts`'nin reuse-detection bloğundaki `updateMany({where:{userId,revokedAt:null},data:{revokedAt:new Date()}})` deseninden `apps/api/src/modules/auth/refreshTokenRevocation.ts`'e çıkarıldı (davranış değişmedi, saf ekstraksiyon). Deaktive edilen kullanıcının **mevcut refresh token'ı** anında reddedilir; **mevcut access token'ı** (≤15dk kalan TTL) stateless JWT olduğu için yeniden kontrol edilmez — bu, sistemin çalıntı access token için zaten kabul ettiği aynı pencere, yeni bir zafiyet değil.

**Kısıt (kilitlenme koruması):** İki invaryant uygulanır — `CannotModifySelfError` (bir OWNER kendi rolünü değiştiremez/kendini deaktive edemez) ve `CannotRemoveLastOwnerError` (tenant'ın tek aktif OWNER'ı deaktive edilemez/rolü değiştirilemez — `count({role:OWNER, deactivatedAt:null}) >= 2` kontrolü). Tenant OWNER'ları başka OWNER da davet edebildiği için (çok-OWNER'lı atölye desteklenir) bu koruma anlamlı.

**Kısıt:** Deaktive edilmiş bir kullanıcı `POST /auth/login`'de `InvalidCredentialsError` ile reddedilir (aktif bir hesap olmadığını ayrı bir mesajla belirtmez — enumeration direnci).

**Durum:** Şema eklendi. Gerçek DB henüz yok (bkz. `docs/local-postgres-setup.md`) — ilk `prisma migrate dev` çalıştırıldığında bu değişiklikler de migration'a dahil olacak.
