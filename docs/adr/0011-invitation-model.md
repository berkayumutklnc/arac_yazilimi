# ADR 0011 — Invitation Modeli (Davet/Redemption, Tek-Kullanımlık Hash'li Token)

**Karar:** Yeni, tenant-scoped bir `Invitation` modeli eklendi: `tenantId, email, role, tokenHash (String @unique), invitedBy (String, FK yok), expiresAt, acceptedAt (DateTime?), revokedAt (DateTime?), createdAt`. `Tenant.invitations Invitation[]` ilişkisi eklendi. `TENANT_SCOPED_MODELS`'e dahil edildi (`User` ile aynı şekil, tek `tenantId` kolonu).

**Gerekçe:** Token üretimi/hash'lenmesi, `RefreshToken`'ın (ADR 0006) ham-token/SHA-256-hash/`expiresAt` desenini **birebir tekrarlar** — aynı güvenlik özelliklerine (ham token asla DB'ye yazılmaz, yalnızca hash) ihtiyaç duyan yeni bir birincil güvenlik ilkesi için tekerleği yeniden icat etmek yerine kanıtlanmış bir deseni tekrar kullanmak tercih edildi.

**Kısıt (tek-kullanımlık):** `acceptedAt IS NULL` koşuluyla korunan bir `updateMany` (ADR 0007'nin count-guard deseni) + `User.create` **aynı transaction'da** — eşzamanlı iki redemption çağrısından yalnızca biri başarılı olur.

**Kısıt (enumeration direnci):** Redemption endpoint'i (`POST /invitations/redeem`) yalnızca `{token, newPassword}` alır — e-posta alanı YOK, bu yüzden yapısal olarak "bu e-posta var mı" oracle'ı oluşturmuyor. Tüm redemption başarısızlık modları (token yok/süresi dolmuş/kullanılmış/iptal edilmiş) **tek bir generic** `InvalidInvitationTokenError`'a indirgeniyor — `InvalidRefreshTokenError`/`InvalidCredentialsError` ile aynı "hangi koşulun başarısız olduğunu asla belirtme" deseni. Önizleme endpoint'i (`GET /invitations/:token`) de aynı generic hata şeklini kullanır — POST'tan daha spesifik bir "token geçerli mi" oracle'ı olmaz.

**Kısıt:** Davet edilen kullanıcı **kendi şifresini redemption sırasında belirler** (`POST /invitations/redeem {token, newPassword}`, Argon2id ile hash'lenir) — geçici bir şifre e-postayla asla taşınmaz (bu, `EmailSender` port'unun sözleşmesine de yansır: `InvitationEmailParams` hiçbir zaman bir şifre alanı taşımaz).

**Kısıt:** Davet TTL'i 7 gün olarak sabitlendi (`INVITATION_TTL_MS`, kolayca değiştirilebilir). Davet iptali (`revoke`) v1 kapsamında YOK — `revokedAt` alanı yine de eklendi ki ileride bir revoke endpoint'i eklemek yeni bir migration gerektirmesin.

**Durum:** Şema eklendi. Gerçek DB henüz yok (bkz. `docs/local-postgres-setup.md`) — ilk `prisma migrate dev` çalıştırıldığında bu tablo da migration'a dahil olacak.
