import { describe, expect, it, vi } from "vitest";
import {
  createWorkOrder,
  listWorkOrders,
  getWorkOrderById,
  VehicleNotFoundError,
  type WorkOrderCrudDb,
} from "./workOrderCrud.service.js";
import { WorkOrderNotFoundError } from "./workOrderTransition.service.js";

const vehicleId = "vehicle-1";
const workOrderId = "wo-1";

function createMockDb() {
  const vehicleFindUnique = vi.fn<WorkOrderCrudDb["vehicle"]["findUnique"]>();
  const workOrderCreate = vi.fn<WorkOrderCrudDb["workOrder"]["create"]>();
  const workOrderFindMany = vi.fn<WorkOrderCrudDb["workOrder"]["findMany"]>();
  const workOrderFindUnique = vi.fn<WorkOrderCrudDb["workOrder"]["findUnique"]>();
  const auditFindMany = vi.fn<WorkOrderCrudDb["workOrderStatusAuditLog"]["findMany"]>();
  const db: WorkOrderCrudDb = {
    vehicle: { findUnique: vehicleFindUnique },
    workOrder: { create: workOrderCreate, findMany: workOrderFindMany, findUnique: workOrderFindUnique },
    workOrderStatusAuditLog: { findMany: auditFindMany },
  };
  return { db, vehicleFindUnique, workOrderCreate, workOrderFindMany, workOrderFindUnique, auditFindMany };
}

describe("createWorkOrder", () => {
  it("araç bu tenant'a ait değilse/yoksa VehicleNotFoundError fırlatır, iş emri oluşmaz", async () => {
    const { db, vehicleFindUnique, workOrderCreate } = createMockDb();
    vehicleFindUnique.mockResolvedValue(null);

    await expect(createWorkOrder(db, { vehicleId })).rejects.toBeInstanceOf(VehicleNotFoundError);
    expect(workOrderCreate).not.toHaveBeenCalled();
  });

  it("araç geçerliyse DRAFT durumunda iş emri oluşturur", async () => {
    const { db, vehicleFindUnique, workOrderCreate } = createMockDb();
    vehicleFindUnique.mockResolvedValue({ id: vehicleId });
    workOrderCreate.mockResolvedValue({ id: workOrderId });

    const result = await createWorkOrder(db, { vehicleId });

    expect(workOrderCreate).toHaveBeenCalledWith({ data: { vehicleId, status: "DRAFT" } });
    expect(result).toEqual({ id: workOrderId });
  });
});

describe("listWorkOrders", () => {
  it("tenant-scoped db üzerinden tüm iş emirlerini döner", async () => {
    const { db, workOrderFindMany } = createMockDb();
    workOrderFindMany.mockResolvedValue([
      { id: workOrderId, vehicleId, status: "DRAFT", requiresAitmRegistration: false, createdAt: new Date() },
    ]);

    const result = await listWorkOrders(db);

    expect(result).toHaveLength(1);
    expect(workOrderFindMany).toHaveBeenCalledWith();
  });
});

describe("getWorkOrderById", () => {
  it("iş emri bulunamazsa WorkOrderNotFoundError fırlatır", async () => {
    const { db, workOrderFindUnique } = createMockDb();
    workOrderFindUnique.mockResolvedValue(null);

    await expect(getWorkOrderById(db, workOrderId)).rejects.toBeInstanceOf(WorkOrderNotFoundError);
  });

  it("iş emri + durum geçmişini (en yeniden en eskiye) birlikte döner", async () => {
    const { db, workOrderFindUnique, auditFindMany } = createMockDb();
    workOrderFindUnique.mockResolvedValue({
      id: workOrderId,
      vehicleId,
      status: "ACCEPTED",
      requiresAitmRegistration: false,
      createdAt: new Date("2026-01-01"),
      engineerId: null,
      closedAt: null,
    });
    auditFindMany.mockResolvedValue([
      {
        fromStatus: "DRAFT",
        toStatus: "ACCEPTED",
        reason: null,
        changedBy: "user-1",
        changedAt: new Date("2026-01-02"),
      },
    ]);

    const result = await getWorkOrderById(db, workOrderId);

    expect(result.status).toBe("ACCEPTED");
    expect(result.statusHistory).toHaveLength(1);
    expect(auditFindMany).toHaveBeenCalledWith({
      where: { workOrderId },
      orderBy: { changedAt: "desc" },
    });
  });
});
