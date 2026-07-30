// bkz. ADR 0014. DRAFT -> ISSUED -> {PAID, VOID}; PAID/VOID uçtur (kısmi
// ödeme takibi kapsam dışı).
export const INVOICE_STATUS_ORDER = ["DRAFT", "ISSUED", "PAID", "VOID"] as const;

export type InvoiceStatus = (typeof INVOICE_STATUS_ORDER)[number];

const ALLOWED_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  DRAFT: ["ISSUED"],
  ISSUED: ["PAID", "VOID"],
  PAID: [],
  VOID: [],
};

// Yalnızca VOID'de zorunlu (rework/iptal deseniyle aynı, bkz. ADR 0003, ADR 0014).
export function requiresReason(_from: InvoiceStatus, to: InvoiceStatus): boolean {
  return to === "VOID";
}

export class InvalidInvoiceTransitionError extends Error {
  constructor(
    public readonly from: InvoiceStatus,
    public readonly to: InvoiceStatus,
  ) {
    super(`Geçersiz fatura durum geçişi: ${from} -> ${to}`);
    this.name = "InvalidInvoiceTransitionError";
  }
}

export function canTransition(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: InvoiceStatus, to: InvoiceStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidInvoiceTransitionError(from, to);
  }
}
