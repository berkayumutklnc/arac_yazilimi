import { z } from "zod";
import { WORK_ORDER_STATUSES, ECU_FILE_TYPES } from "../types/index.js";

// Bu şemalar apps/api'nin route-seviyesi zod doğrulamalarının bir aynasıdır —
// apps/web bunları form doğrulama İÇİN kullanır; asıl/zorunlu doğrulama her
// zaman backend'de yapılır (bkz. CLAUDE.md kural 4). Elle `interface` yazmak
// yerine buradaki `z.infer<>` tipleri tek kaynak (bkz. plan).

export const loginSchema = z.object({
  tenantSlug: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createWorkOrderSchema = z.object({
  vehicleId: z.string().min(1),
});
export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

export const transitionWorkOrderSchema = z.object({
  toStatus: z.enum(WORK_ORDER_STATUSES),
  // Rework (QUALITY_CHECK -> IN_PROGRESS) ve iptal (-> CANCELLED) dallarında
  // zorunlu — bkz. workOrderStatusMachine.ts requiresReason.
  reason: z.string().min(1).optional(),
});
export type TransitionWorkOrderInput = z.infer<typeof transitionWorkOrderSchema>;

export const uploadRequestSchema = z.object({
  fileName: z.string().min(1).max(255),
});
export type UploadRequestInput = z.infer<typeof uploadRequestSchema>;

export const uploadConfirmSchema = z.object({
  storageKey: z.string().min(1),
  fileType: z.enum(ECU_FILE_TYPES),
  claimedChecksum: z.string().min(1),
  stockRomRef: z.string().min(1).optional(),
});
export type UploadConfirmInput = z.infer<typeof uploadConfirmSchema>;

export const createFileRequestSchema = z.object({
  hubTenantId: z.string().min(1),
  vehicleId: z.string().min(1),
  readFileId: z.string().min(1),
  requestedStage: z.enum(ECU_FILE_TYPES).refine((value) => value !== "ORIGINAL_STOCK", {
    message: "ORIGINAL_STOCK bir stage talebi olarak istenemez.",
  }),
});
export type CreateFileRequestInput = z.infer<typeof createFileRequestSchema>;

export const acceptFileRequestSchema = z.object({
  costKurus: z.number().int().nonnegative(),
});
export type AcceptFileRequestInput = z.infer<typeof acceptFileRequestSchema>;

export const fulfillFileRequestSchema = z.object({
  storageKey: z.string().min(1),
  checksum: z.string().min(1),
});
export type FulfillFileRequestInput = z.infer<typeof fulfillFileRequestSchema>;
