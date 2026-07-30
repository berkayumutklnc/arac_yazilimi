import type { WorkOrderStatus } from "./types/index.js";

// bkz. apps/api/src/modules/workorder/workOrderStatus.machine.ts — bu KÜÇÜK
// bir aynadır, yalnızca UI'da "hangi durum geçiş butonları gösterilsin"
// kararı için kullanılır. YETKİLİ/zorunlu kılan taraf HER ZAMAN backend'dir
// (istemci bunu atlasa bile sunucu 409/400 ile reddeder) — bu dosya
// değişirse apps/api'deki asıl karar mekanizmasıyla senkron tutulmalı.
const ALLOWED_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  DRAFT: ["ACCEPTED", "CANCELLED"],
  ACCEPTED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["AWAITING_PARTS", "CANCELLED"],
  AWAITING_PARTS: ["QUALITY_CHECK", "CANCELLED"],
  // Rework: kalite kontrolde başarısız olan iş tekrar üretime döner.
  QUALITY_CHECK: ["DELIVERED", "IN_PROGRESS"],
  DELIVERED: ["CLOSED"],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function getAllowedNextStatuses(from: WorkOrderStatus): readonly WorkOrderStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

// Rework ve iptal dalları, iş emri geçmişinde bir açıklama gerektiren
// istisnai olaylar — bu iki dal için reason zorunlu.
export function requiresReason(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return to === "CANCELLED" || (from === "QUALITY_CHECK" && to === "IN_PROGRESS");
}
