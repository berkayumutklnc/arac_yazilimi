import { assertValidTransition, requiresReason, type WorkOrderStatus } from "./workOrderStatus.machine.js";

export class WorkOrderNotFoundError extends Error {
  constructor(workOrderId: string) {
    super(`İş emri bulunamadı: ${workOrderId}`);
    this.name = "WorkOrderNotFoundError";
  }
}

export class MissingTransitionReasonError extends Error {
  constructor(
    public readonly from: WorkOrderStatus,
    public readonly to: WorkOrderStatus,
  ) {
    super(`${from} -> ${to} geçişi için "reason" zorunludur.`);
    this.name = "MissingTransitionReasonError";
  }
}

// AppScopedDb, bu arayüzü WorkOrderComplianceDb ile intersect ediyor (aynı
// alttaki workOrder.findUnique çağrısı) — iki servisin dönüş tipi çakışmasın
// diye export edilip workOrderCompliance.service.ts'te de reuse ediliyor.
export interface WorkOrderRecord {
  id: string;
  status: WorkOrderStatus;
}

// tenantId bu arayüzde bilinçli olarak YOK — db, authPreHandler'da request
// başına oluşturulan tenant-scoped bir istemci (bkz. db/tenantScopedDb.ts);
// tenantId'yi elle geçmeye çalışmak artık bir tip hatasıdır (ADR 0006).
export interface WorkOrderTransitionDb {
  workOrder: {
    findUnique: (args: { where: { id: string } }) => Promise<WorkOrderRecord | null>;
    update: (args: {
      where: { id: string };
      data: { status: WorkOrderStatus };
    }) => Promise<unknown>;
  };
  workOrderStatusAuditLog: {
    create: (args: {
      data: {
        workOrderId: string;
        fromStatus: WorkOrderStatus;
        toStatus: WorkOrderStatus;
        reason: string | null;
        changedBy: string;
      };
    }) => Promise<unknown>;
  };
}

export interface TransitionWorkOrderStatusParams {
  workOrderId: string;
  toStatus: WorkOrderStatus;
  changedBy: string;
  // Rework (QUALITY_CHECK -> IN_PROGRESS) ve iptal (-> CANCELLED) dallarında
  // zorunlu — bkz. workOrderStatus.machine.ts requiresReason, ADR 0003 revizyonu.
  reason?: string;
}

export async function transitionWorkOrderStatus(
  db: WorkOrderTransitionDb,
  params: TransitionWorkOrderStatusParams,
): Promise<void> {
  const workOrder = await db.workOrder.findUnique({
    where: { id: params.workOrderId },
  });

  if (!workOrder) {
    throw new WorkOrderNotFoundError(params.workOrderId);
  }

  assertValidTransition(workOrder.status, params.toStatus);

  if (requiresReason(workOrder.status, params.toStatus) && !params.reason) {
    throw new MissingTransitionReasonError(workOrder.status, params.toStatus);
  }

  await db.workOrder.update({
    where: { id: workOrder.id },
    data: { status: params.toStatus },
  });

  await db.workOrderStatusAuditLog.create({
    data: {
      workOrderId: workOrder.id,
      fromStatus: workOrder.status,
      toStatus: params.toStatus,
      reason: params.reason ?? null,
      changedBy: params.changedBy,
    },
  });
}
