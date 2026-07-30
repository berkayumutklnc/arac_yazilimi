# ADR 0013 — DealerAccount Bağlama Akışı (Propose/Approve Durum Makinesi)

**Karar:** Yeni `DealerAccountStatus` enum'u: `PENDING | ACTIVE | REJECTED`. `DealerAccount`'a eklendi: `status DealerAccountStatus @default(PENDING)`, `requestedBy String`, `approvedBy String? `, `respondedAt DateTime?`. `@@unique([hubTenantId, dealerTenantId])` **değişmedi** — artık "bu çift için (hangi durumda olursa olsun) tek kayıt" anlamına gelir, bu da tekrar-öneri engeli olarak çalışır.

**Gerekçe:** Bugüne kadar `DealerAccount`'un varlığı TEK BAŞINA "bağlantı kuruldu" anlamına geliyordu ve tek oluşturma yolu `seedE2e.ts`'ti — üretimde bir bağlantının nasıl kurulacağına dair hiçbir akış yoktu. Hub tenant'ın OWNER'ı bir bağlantı **önerir** (`status: PENDING`), yalnızca dealer tenant'ın OWNER'ı **onaylayabilir veya reddedebilir** (`status: ACTIVE` veya `REJECTED`) — hub kendi önerdiği bağlantıyı onaylayamaz (bkz. `tenantIsolation.security.test.ts`'e eklenen regresyon senaryosu).

**Kısıt (eşzamanlılık):** Onay/red, ADR 0007'nin count-guard'lı `updateMany({where:{id,status:"PENDING"},data:{status,approvedBy,respondedAt}})` deseniyle uygulanır — eşzamanlı çift yanıtı tek bir SQL ifadesi engeller, ayrı bir `FOR UPDATE` kilidi gerekmez (kredi bakiyesi burada henüz devrede değil).

**Kısıt (v1 sınırlaması):** `REJECTED` bir kayıt yeniden önerilemez (aynı unique kısıt bunu engeller) — yeniden önermek isteyen taraf mevcut kaydı güncelleyecek/silecek ayrı bir endpoint'e ihtiyaç duyar; bu görevde YOK, ileriye dönük not olarak bırakıldı.

**Kısıt:** Kredi top-up endpoint'i (`POST /dealer/accounts/:id/credit-topup`) yeni bir şema değişikliği gerektirmiyor (`DealerCreditTransaction.amountKurus` zaten işaretli bir integer) — yalnızca ADR 0007'nin `FOR UPDATE` kilitleme stratejisinin yeni bir çağrıcısı, yalnızca `status === "ACTIVE"` hesaplar için ve yalnızca hub tarafının OWNER'ı (`fileRequest`'in `HUB_ROLES=[OWNER,ENGINEER]`'inden daha dar — kullanıcı isteğinde açıkça "yalnızca hub OWNER").

**Durum:** Şema eklendi. Gerçek DB henüz yok (bkz. `docs/local-postgres-setup.md`) — ilk `prisma migrate dev` çalıştırıldığında bu değişiklikler de migration'a dahil olacak.
