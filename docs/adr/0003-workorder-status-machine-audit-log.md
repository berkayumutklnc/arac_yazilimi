# ADR 0003 — WorkOrder Durum Makinesi ve Audit Log

**Karar:** `WorkOrderStatus` enum'ı `DRAFT, ACCEPTED, IN_PROGRESS, AWAITING_PARTS, QUALITY_CHECK, DELIVERED, CLOSED` olarak değiştirildi (eski `OPEN/AWAITING_AITM/CANCELLED` kaldırıldı); geçişler **sıkı doğrusal** (her durum sadece bir sonraki duruma geçebilir, geri dönüş/atlama yok) bir durum makinesiyle uygulama katmanında zorunlu kılınıyor.
**Gerekçe:** İstenen yaşam döngüsü tam olarak bu 7 durumun sıralı zinciri; geri alma/rework/iptal akışları bu görevde talep edilmedi, ileride ayrı bir görev olarak eklenebilir (bkz. yorum notu).
**Yeni model:** `WorkOrderStatusAuditLog` (tenantId, workOrderId, fromStatus, toStatus, changedBy, changedAt) — her başarılı geçişte tek satır; geçersiz geçiş denemesi kayıt oluşturmadan reddedilir (409).
**Kısıt:** Geçersiz geçiş denemesi API seviyesinde `InvalidWorkOrderTransitionError` → HTTP 409; iş emri bulunamazsa `WorkOrderNotFoundError` → HTTP 404.
**Durum:** Taslak — gerçek Postgres bağlantısı yok; DB tarafı `prisma validate/generate` ile, davranış katmanı Vitest + Fastify `inject()` ile doğrulanıyor. Tenant/auth middleware (Epic 0) henüz yazılmadığı için route şu an `tenantId`'yi istek gövdesinden alıyor — Epic 0 tamamlanınca oturumdan alınacak şekilde değiştirilmeli.
