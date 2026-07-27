import { assertValidTransition, type WorkOrderStatus } from "./workOrderStatus.machine.js";

export class WorkOrderNotFoundError extends Error {
  constructor(workOrderId: string) {
    super(`İş emri bulunamadı: ${workOrderId}`);
    this.name = "WorkOrderNotFoundError";
  }
}

interface WorkOrderRecord {
  id: string;
  tenantId: string;
  status: WorkOrderStatus;
}

export interface WorkOrderTransitionDb {
  workOrder: {
    findUnique: (args: {
      where: { id: string; tenantId: string };
    }) => Promise<WorkOrderRecord | null>;
    update: (args: {
      where: { id: string };
      data: { status: WorkOrderStatus };
    }) => Promise<unknown>;
  };
  workOrderStatusAuditLog: {
    create: (args: {
      data: {
        tenantId: string;
        workOrderId: string;
        fromStatus: WorkOrderStatus;
        toStatus: WorkOrderStatus;
        changedBy: string;
      };
    }) => Promise<unknown>;
  };
}

export interface TransitionWorkOrderStatusParams {
  workOrderId: string;
  tenantId: string;
  toStatus: WorkOrderStatus;
  changedBy: string;
}

export async function transitionWorkOrderStatus(
  db: WorkOrderTransitionDb,
  params: TransitionWorkOrderStatusParams,
): Promise<void> {
  const workOrder = await db.workOrder.findUnique({
    where: { id: params.workOrderId, tenantId: params.tenantId },
  });

  if (!workOrder) {
    throw new WorkOrderNotFoundError(params.workOrderId);
  }

  assertValidTransition(workOrder.status, params.toStatus);

  await db.workOrder.update({
    where: { id: workOrder.id },
    data: { status: params.toStatus },
  });

  await db.workOrderStatusAuditLog.create({
    data: {
      tenantId: params.tenantId,
      workOrderId: workOrder.id,
      fromStatus: workOrder.status,
      toStatus: params.toStatus,
      changedBy: params.changedBy,
    },
  });
}
