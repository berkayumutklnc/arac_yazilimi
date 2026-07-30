import type { WorkOrderItemType, VatRate } from "../../generated/prisma/enums.js";
import { computeLineAmounts } from "../billing/invoiceMath.js";
import { WorkOrderNotFoundError, type WorkOrderRecord } from "./workOrderTransition.service.js";

// DELIVERED anında kalemler donar — fatura o anki hâlin bir anlık görüntüsüdür
// (bkz. ADR 0014). CLOSED/CANCELLED de aynı gerekçeyle kilitli.
const LOCKED_STATUSES: ReadonlySet<WorkOrderRecord["status"]> = new Set([
  "DELIVERED",
  "CLOSED",
  "CANCELLED",
]);

export class WorkOrderItemsLockedError extends Error {
  constructor(workOrderId: string) {
    super(`İş emri ${workOrderId} teslim edilmiş/kapanmış/iptal edilmiş — kalemler artık değiştirilemez.`);
    this.name = "WorkOrderItemsLockedError";
  }
}

export class WorkOrderItemNotFoundError extends Error {
  constructor(itemId: string) {
    super(`İş emri kalemi bulunamadı: ${itemId}`);
    this.name = "WorkOrderItemNotFoundError";
  }
}

export interface WorkOrderItemRecord {
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
  createdAt: Date;
}

// tenantId bilinçli olarak yok — db, request başına tenant-scoped oluşturulur
// (bkz. db/tenantScopedDb.ts, ADR 0006).
export interface WorkOrderItemDb {
  workOrder: {
    findUnique: (args: { where: { id: string } }) => Promise<WorkOrderRecord | null>;
  };
  workOrderItem: {
    create: (args: {
      data: {
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
      };
    }) => Promise<WorkOrderItemRecord>;
    findMany: (args: {
      where: { workOrderId: string };
      orderBy: { createdAt: "asc" };
    }) => Promise<WorkOrderItemRecord[]>;
    findUnique: (args: { where: { id: string } }) => Promise<WorkOrderItemRecord | null>;
    delete: (args: { where: { id: string } }) => Promise<unknown>;
  };
}

export interface AddWorkOrderItemParams {
  workOrderId: string;
  itemType: WorkOrderItemType;
  description: string;
  serviceTypeId?: string;
  quantity: number;
  unitPriceKurus: number;
  vatRate: VatRate;
}

async function loadUnlockedWorkOrder(db: WorkOrderItemDb, workOrderId: string): Promise<WorkOrderRecord> {
  const workOrder = await db.workOrder.findUnique({ where: { id: workOrderId } });
  if (!workOrder) {
    throw new WorkOrderNotFoundError(workOrderId);
  }
  if (LOCKED_STATUSES.has(workOrder.status)) {
    throw new WorkOrderItemsLockedError(workOrderId);
  }
  return workOrder;
}

export async function addWorkOrderItem(
  db: WorkOrderItemDb,
  params: AddWorkOrderItemParams,
): Promise<WorkOrderItemRecord> {
  await loadUnlockedWorkOrder(db, params.workOrderId);

  const amounts = computeLineAmounts({
    quantity: params.quantity,
    unitPriceKurus: params.unitPriceKurus,
    vatRate: params.vatRate,
  });

  return db.workOrderItem.create({
    data: {
      workOrderId: params.workOrderId,
      itemType: params.itemType,
      description: params.description,
      serviceTypeId: params.serviceTypeId ?? null,
      quantity: params.quantity,
      unitPriceKurus: params.unitPriceKurus,
      vatRate: params.vatRate,
      ...amounts,
    },
  });
}

export async function removeWorkOrderItem(
  db: WorkOrderItemDb,
  workOrderId: string,
  itemId: string,
): Promise<void> {
  await loadUnlockedWorkOrder(db, workOrderId);

  const item = await db.workOrderItem.findUnique({ where: { id: itemId } });
  if (!item || item.workOrderId !== workOrderId) {
    throw new WorkOrderItemNotFoundError(itemId);
  }

  await db.workOrderItem.delete({ where: { id: itemId } });
}

export async function listWorkOrderItems(
  db: WorkOrderItemDb,
  workOrderId: string,
): Promise<WorkOrderItemRecord[]> {
  return db.workOrderItem.findMany({
    where: { workOrderId },
    orderBy: { createdAt: "asc" },
  });
}
