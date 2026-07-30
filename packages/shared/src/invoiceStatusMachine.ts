import type { InvoiceStatus } from "./types/index.js";

// bkz. apps/api/src/modules/billing/invoiceStatus.machine.ts — bu KÜÇÜK bir
// aynadır, yalnızca UI'da "hangi fatura aksiyon butonları gösterilsin" kararı
// için kullanılır. YETKİLİ/zorunlu kılan taraf HER ZAMAN backend'dir (istemci
// bunu atlasa bile sunucu 409/400 ile reddeder) — bu dosya değişirse
// apps/api'deki asıl karar mekanizmasıyla senkron tutulmalı.
const ALLOWED_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ["ISSUED"],
  ISSUED: ["PAID", "VOID"],
  PAID: [],
  VOID: [],
};

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function getAllowedNextStatuses(from: InvoiceStatus): readonly InvoiceStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

// Yalnızca VOID'de zorunlu (bkz. ADR 0014).
export function requiresReason(_from: InvoiceStatus, to: InvoiceStatus): boolean {
  return to === "VOID";
}
