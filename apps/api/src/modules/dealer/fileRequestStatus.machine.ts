// Hub/dealer dosya talebi yaşam döngüsü (bkz. docs/adr/0005-dealer-hub-file-request-credit.md):
// WorkOrder'ın aksine dallanmalı — PENDING/ACCEPTED'tan REJECTED'a çıkış var.
export const FILE_REQUEST_STATUS_ORDER = [
  "PENDING",
  "ACCEPTED",
  "IN_PROGRESS",
  "FULFILLED",
  "REJECTED",
] as const;

export type FileRequestStatus = (typeof FILE_REQUEST_STATUS_ORDER)[number];

const ALLOWED_TRANSITIONS: Record<FileRequestStatus, readonly FileRequestStatus[]> = {
  PENDING: ["ACCEPTED", "REJECTED"],
  ACCEPTED: ["IN_PROGRESS", "REJECTED"],
  IN_PROGRESS: ["FULFILLED"],
  FULFILLED: [],
  REJECTED: [],
};

export class InvalidFileRequestTransitionError extends Error {
  constructor(
    public readonly from: FileRequestStatus,
    public readonly to: FileRequestStatus,
  ) {
    super(`Geçersiz talep durum geçişi: ${from} -> ${to}`);
    this.name = "InvalidFileRequestTransitionError";
  }
}

export function canTransition(from: FileRequestStatus, to: FileRequestStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertValidTransition(from: FileRequestStatus, to: FileRequestStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidFileRequestTransitionError(from, to);
  }
}
