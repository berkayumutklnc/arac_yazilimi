// Ana zincir sıkı doğrusal (bkz. docs/adr/0003-workorder-status-machine-audit-log.md),
// artı iki bilinçli dal: QUALITY_CHECK -> IN_PROGRESS (rework) ve
// {DRAFT,ACCEPTED,IN_PROGRESS,AWAITING_PARTS} -> CANCELLED (DELIVERED/CLOSED'dan
// iptal yok). Bu dizi artık "geçerli durumların kümesi" — sıra, zincirdeki
// akışı belgeliyor ama tek başına geçiş kuralı değil (bkz. ALLOWED_TRANSITIONS).
export const WORK_ORDER_STATUS_ORDER = [
  "DRAFT",
  "ACCEPTED",
  "IN_PROGRESS",
  "AWAITING_PARTS",
  "QUALITY_CHECK",
  "DELIVERED",
  "CLOSED",
  "CANCELLED",
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUS_ORDER)[number];

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

// Rework ve iptal dalları, iş emri geçmişinde bir açıklama gerektiren
// istisnai olaylar — bu iki dal için reason zorunlu (bkz. ADR 0003 revizyonu).
export function requiresReason(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return to === "CANCELLED" || (from === "QUALITY_CHECK" && to === "IN_PROGRESS");
}

export class InvalidWorkOrderTransitionError extends Error {
  constructor(
    public readonly from: WorkOrderStatus,
    public readonly to: WorkOrderStatus,
  ) {
    super(`Geçersiz durum geçişi: ${from} -> ${to}`);
    this.name = "InvalidWorkOrderTransitionError";
  }
}

export function canTransition(from: WorkOrderStatus, to: WorkOrderStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: WorkOrderStatus, to: WorkOrderStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidWorkOrderTransitionError(from, to);
  }
}
