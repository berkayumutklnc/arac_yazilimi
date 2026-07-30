import type { components as DiagServiceComponents } from "../generated/diagServiceTypes.js";

// apps/api'nin Prisma enum'larını AYNEN yansıtır ama import ETMEZ —
// packages/shared, apps/api'nin üretilmiş Prisma client'ına bağımlı değil
// (bilinçli mimari sınır, bkz. plan). Bu diziler değişirse apps/api/prisma/
// schema.prisma ile senkron tutulmalı.
// SUPER_ADMIN: kiracılar-üstü platform yöneticisi (bkz. ADR 0010) — tenant-içi
// davetlerde asla seçilemez (apps/api zod şeması SUPER_ADMIN'i zaten dışlıyor).
export const ROLES = ["OWNER", "ENGINEER", "RECEPTIONIST", "DEALER", "SUPER_ADMIN"] as const;
export type Role = (typeof ROLES)[number];

// Tenant-içi davetlerde seçilebilecek roller — SUPER_ADMIN hariç (bkz. ADR 0010/0012).
export const INVITABLE_ROLES = ["OWNER", "ENGINEER", "RECEPTIONIST", "DEALER"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const DEALER_ACCOUNT_STATUSES = ["PENDING", "ACTIVE", "REJECTED"] as const;
export type DealerAccountStatus = (typeof DEALER_ACCOUNT_STATUSES)[number];

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

// --- Platform admin (bkz. ADR 0010/0011) ---
export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface TenantListResponse {
  items: TenantSummary[];
}

export interface CreateTenantResponse {
  tenant: TenantSummary;
}

// --- Kiracı-içi kullanıcı yönetimi (bkz. ADR 0011/0012) ---
export interface TenantUserSummary {
  id: string;
  email: string;
  role: Role;
  deactivatedAt: string | null;
  createdAt: string;
}

export interface TenantUserListResponse {
  items: TenantUserSummary[];
}

export interface InvitationSummary {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export interface InvitationListResponse {
  items: InvitationSummary[];
}

export interface CreateInvitationResponse {
  invitation: Pick<InvitationSummary, "id" | "email" | "role" | "expiresAt">;
}

export interface InvitationPreviewResponse {
  tenantId: string;
  email: string;
  role: Role;
}

// --- Bayi bağlama + kredi (bkz. ADR 0013) ---
export interface DealerLinkSummary {
  id: string;
  hubTenantId: string;
  dealerTenantId: string;
  status: DealerAccountStatus;
  requestedBy: string;
  approvedBy: string | null;
  respondedAt: string | null;
  creditBalanceKurus: number;
  createdAt: string;
}

export interface DealerLinkListResponse {
  items: DealerLinkSummary[];
}

export interface CreditTopUpResponse {
  balanceAfterKurus: number;
}

// --- Faturalama (bkz. ADR 0014) ---
export const WORK_ORDER_ITEM_TYPES = ["SERVICE", "PART"] as const;
export type WorkOrderItemType = (typeof WORK_ORDER_ITEM_TYPES)[number];

// Türkiye KDV dilimleri.
export const VAT_RATES = ["RATE_0", "RATE_1", "RATE_10", "RATE_20"] as const;
export type VatRate = (typeof VAT_RATES)[number];

// Frontend'de satır toplamı önizlemesi için — asıl hesap her zaman backend'de
// yapılır (bkz. apps/api/src/modules/billing/invoiceMath.ts).
export const VAT_RATE_PERCENTAGES: Record<VatRate, number> = {
  RATE_0: 0,
  RATE_1: 1,
  RATE_10: 10,
  RATE_20: 20,
};

export const INVOICE_STATUSES = ["DRAFT", "ISSUED", "PAID", "VOID"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export interface WorkOrderItemSummary {
  id: string;
  workOrderId: string;
  itemType: WorkOrderItemType;
  description: string;
  serviceTypeId: string | null;
  quantity: number;
  unitPriceKurus: number;
  vatRate: VatRate;
  netAmountKurus: number;
  vatAmountKurus: number;
  lineTotalKurus: number;
  createdAt: string;
}

export interface WorkOrderItemListResponse {
  items: WorkOrderItemSummary[];
}

export interface InvoiceLineSummary {
  id: string;
  description: string;
  quantity: number;
  unitPriceKurus: number;
  vatRate: VatRate;
  netAmountKurus: number;
  vatAmountKurus: number;
  lineTotalKurus: number;
}

export interface InvoiceSummary {
  id: string;
  workOrderId: string;
  status: InvoiceStatus;
  invoiceNumber: string | null;
  issuedAt: string | null;
  voidedAt: string | null;
  totalKurus: number;
  createdAt: string;
}

// GET /work-orders/:id/invoice satır tablosunu da döner — issue/pay/void
// aksiyonlarının yanıtı satırları taşımaz (kalemler DELIVERED anında donduğu
// için değişmezler, frontend aksiyon sonrası GET'i tekrar çağırır).
export interface InvoiceDetail extends InvoiceSummary {
  lines: InvoiceLineSummary[];
}

// --- Generic ---
export interface ApiErrorBody {
  error: string;
  [key: string]: unknown;
}
