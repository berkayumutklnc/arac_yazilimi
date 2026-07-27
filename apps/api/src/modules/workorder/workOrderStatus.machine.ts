// Sıkı doğrusal yaşam döngüsü (bkz. docs/adr/0003-workorder-status-machine-audit-log.md):
// geri dönüş veya adım atlama yok, her durum yalnızca zincirdeki bir sonraki duruma geçebilir.
export const WORK_ORDER_STATUS_ORDER = [
  "DRAFT",
  "ACCEPTED",
  "IN_PROGRESS",
  "AWAITING_PARTS",
  "QUALITY_CHECK",
  "DELIVERED",
  "CLOSED",
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUS_ORDER)[number];

const ALLOWED_TRANSITIONS: Record<WorkOrderStatus, readonly WorkOrderStatus[]> = {
  DRAFT: ["ACCEPTED"],
  ACCEPTED: ["IN_PROGRESS"],
  IN_PROGRESS: ["AWAITING_PARTS"],
  AWAITING_PARTS: ["QUALITY_CHECK"],
  QUALITY_CHECK: ["DELIVERED"],
  DELIVERED: ["CLOSED"],
  CLOSED: [],
};

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
