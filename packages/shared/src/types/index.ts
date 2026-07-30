import type { components as DiagServiceComponents } from "../generated/diagServiceTypes.js";

// apps/api'nin Prisma enum'larını AYNEN yansıtır ama import ETMEZ —
// packages/shared, apps/api'nin üretilmiş Prisma client'ına bağımlı değil
// (bilinçli mimari sınır, bkz. plan). Bu diziler değişirse apps/api/prisma/
// schema.prisma ile senkron tutulmalı.
export const ROLES = ["OWNER", "ENGINEER", "RECEPTIONIST", "DEALER"] as const;
export type Role = (typeof ROLES)[number];

export const WORK_ORDER_STATUSES = [
  "DRAFT",
  "ACCEPTED",
  "IN_PROGRESS",
  "AWAITING_PARTS",
  "QUALITY_CHECK",
  "DELIVERED",
  "CLOSED",
  "CANCELLED",
] as const;
export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

export const ECU_FILE_TYPES = ["ORIGINAL_STOCK", "STAGE1", "STAGE2", "CUSTOM"] as const;
export type EcuFileType = (typeof ECU_FILE_TYPES)[number];

export const FILE_REQUEST_STATUSES = ["PENDING", "ACCEPTED", "IN_PROGRESS", "FULFILLED", "REJECTED"] as const;
export type FileRequestStatus = (typeof FILE_REQUEST_STATUSES)[number];

// --- Auth ---
export interface LoginResponse {
  accessToken: string;
}

export interface RefreshResponse {
  accessToken: string;
}

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
}

// --- WorkOrder ---
// Tarihler her zaman ISO string — JSON üzerinden Date hiçbir zaman gelmez.
export interface WorkOrderSummary {
  id: string;
  vehicleId: string;
  status: WorkOrderStatus;
  requiresAitmRegistration: boolean;
  createdAt: string;
}

export interface WorkOrderStatusHistoryEntry {
  fromStatus: WorkOrderStatus;
  toStatus: WorkOrderStatus;
  reason: string | null;
  changedBy: string;
  changedAt: string;
}

export interface WorkOrderDetail extends WorkOrderSummary {
  engineerId: string | null;
  closedAt: string | null;
  statusHistory: WorkOrderStatusHistoryEntry[];
}

export interface WorkOrderListResponse {
  items: WorkOrderSummary[];
}

export interface CreateWorkOrderResponse {
  id: string;
}

// --- EcuFile ---
export interface EcuFileListItem {
  id: string;
  fileType: EcuFileType;
  // ORIGINAL_STOCK dosyası kendine referans verir — id === stockRomRef olan
  // kök, diğerleri onun çocuğu (bkz. apps/web ağaç kurma mantığı).
  stockRomRef: string;
  checksum: string;
  uploadedBy: string;
  createdAt: string;
}

export interface EcuFileListResponse {
  items: EcuFileListItem[];
}

export interface UploadRequestResponse {
  uploadUrl: string;
  storageKey: string;
}

export interface UploadConfirmResponse {
  id: string;
}

export interface DownloadResponse {
  downloadUrl: string;
}

// --- Dealer / FileRequest ---
export interface FileRequestListItem {
  id: string;
  hubTenantId: string;
  dealerTenantId: string;
  vehicleId: string;
  requestedStage: EcuFileType;
  status: FileRequestStatus;
  costKurus: number | null;
  resultFileId: string | null;
  requestedBy: string;
  processedBy: string | null;
  createdAt: string;
}

export interface FileRequestListResponse {
  items: FileRequestListItem[];
}

export interface CreateFileRequestResponse {
  id: string;
}

export interface DealerAccountBalance {
  creditBalanceKurus: number;
}

// --- Diagnostik rapor (apps/diag-service istemcisi, bkz. ADR 0009) ---
// components["schemas"][...]'den temiz alias'lar — openapi-typescript'in
// üretttiği ham `paths`/`components` tiplerini doğrudan tüketmek yerine.
// `src/generated/diagServiceTypes.ts` commit edilmez, `npm run
// generate:diag-types` ile üretilir (apps/api'nin Prisma client'ıyla aynı
// konvansiyon).
export type DtcMatch = DiagServiceComponents["schemas"]["DtcMatch"];
export type DtcParseResponse = DiagServiceComponents["schemas"]["DtcParseResponse"];
export type Finding = DiagServiceComponents["schemas"]["Finding"];
export type WotAnalysisResponse = DiagServiceComponents["schemas"]["WotAnalysisResponse"];

export const DIAGNOSTIC_REPORT_TYPES = ["DTC", "WOT"] as const;
export type DiagnosticReportType = (typeof DIAGNOSTIC_REPORT_TYPES)[number];

export interface WorkOrderDiagnosticReportSummary {
  id: string;
  workOrderId: string;
  reportType: DiagnosticReportType;
  fileName: string;
  // Sunucu zod ile doğruladıktan sonra yazdığı için burada da DtcParseResponse
  // | WotAnalysisResponse birleşimi güvenle temsil edilebilir.
  result: unknown;
  uploadedBy: string;
  createdAt: string;
}

export interface DiagnosticReportListResponse {
  items: WorkOrderDiagnosticReportSummary[];
}

// --- Generic ---
export interface ApiErrorBody {
  error: string;
  [key: string]: unknown;
}
