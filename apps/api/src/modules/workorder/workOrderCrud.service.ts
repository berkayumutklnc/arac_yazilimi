import { WorkOrderNotFoundError, type WorkOrderRecord } from "./workOrderTransition.service.js";

export class VehicleNotFoundError extends Error {
  constructor(vehicleId: string) {
    super(`Araç bulunamadı veya bu tenant'a ait değil: ${vehicleId}`);
    this.name = "VehicleNotFoundError";
  }
}

// WorkOrderRecord'u (workOrderTransition.service.ts) genişletir — AppScopedDb
// kesişiminde workOrder.findUnique için tip çakışması olmasın diye (bkz. o
// dosyadaki not, aynı desen burada da geçerli).
export interface WorkOrderSummary extends WorkOrderRecord {
  vehicleId: string;
  requiresAitmRegistration: boolean;
  createdAt: Date;
}

export interface WorkOrderDetailRow extends WorkOrderSummary {
  engineerId: string | null;
  closedAt: Date | null;
}

export interface WorkOrderStatusHistoryEntry {
  fromStatus: WorkOrderRecord["status"];
  toStatus: WorkOrderRecord["status"];
  reason: string | null;
  changedBy: string;
  changedAt: Date;
}

export interface WorkOrderDetail extends WorkOrderDetailRow {
  statusHistory: WorkOrderStatusHistoryEntry[];
}

// tenantId bilinçli olarak yok — db, request başına tenant-scoped oluşturulur
// (bkz. db/tenantScopedDb.ts, ADR 0006). Vehicle otomatik-scope listesinde
// olduğu için vehicle.findUnique({where:{id}}) zaten yalnızca çağıranın
// tenant'ındaki aracı bulabilir.
export interface WorkOrderCrudDb {
  vehicle: {
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string } | null>;
  };
  workOrder: {
    create: (args: {
      data: { vehicleId: string; status: "DRAFT" };
    }) => Promise<{ id: string }>;
    findMany: () => Promise<WorkOrderSummary[]>;
    findUnique: (args: { where: { id: string } }) => Promise<WorkOrderDetailRow | null>;
  };
  workOrderStatusAuditLog: {
    findMany: (args: {
      where: { workOrderId: string };
      orderBy: { changedAt: "desc" };
    }) => Promise<WorkOrderStatusHistoryEntry[]>;
  };
}

export interface CreateWorkOrderParams {
  vehicleId: string;
}

export async function createWorkOrder(
  db: WorkOrderCrudDb,
  params: CreateWorkOrderParams,
): Promise<{ id: string }> {
  const vehicle = await db.vehicle.findUnique({ where: { id: params.vehicleId } });
  if (!vehicle) {
    throw new VehicleNotFoundError(params.vehicleId);
  }

  return db.workOrder.create({ data: { vehicleId: params.vehicleId, status: "DRAFT" } });
}

export async function listWorkOrders(db: WorkOrderCrudDb): Promise<WorkOrderSummary[]> {
  return db.workOrder.findMany();
}

export async function getWorkOrderById(db: WorkOrderCrudDb, workOrderId: string): Promise<WorkOrderDetail> {
  const workOrder = await db.workOrder.findUnique({ where: { id: workOrderId } });
  if (!workOrder) {
    throw new WorkOrderNotFoundError(workOrderId);
  }

  const statusHistory = await db.workOrderStatusAuditLog.findMany({
    where: { workOrderId },
    orderBy: { changedAt: "desc" },
  });

  return { ...workOrder, statusHistory };
}
