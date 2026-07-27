import { describe, expect, it, vi } from "vitest";
import {
  transitionWorkOrderStatus,
  WorkOrderNotFoundError,
  type WorkOrderTransitionDb,
} from "./workOrderTransition.service.js";
import { InvalidWorkOrderTransitionError } from "./workOrderStatus.machine.js";

const tenantId = "tenant-1";
const workOrderId = "wo-1";
const changedBy = "user-1";

function createMockDb() {
  const findUnique = vi.fn<WorkOrderTransitionDb["workOrder"]["findUnique"]>();
  const update = vi.fn<WorkOrderTransitionDb["workOrder"]["update"]>();
  const create = vi.fn<WorkOrderTransitionDb["workOrderStatusAuditLog"]["create"]>();
  const db: WorkOrderTransitionDb = {
    workOrder: { findUnique, update },
    workOrderStatusAuditLog: { create },
  };
  return { db, findUnique, update, create };
}

describe("transitionWorkOrderStatus", () => {
  it("iş emri bulunamazsa WorkOrderNotFoundError fırlatır", async () => {
    const { db, update, create } = createMockDb();
    db.workOrder.findUnique = vi.fn().mockResolvedValue(null);

    await expect(
      transitionWorkOrderStatus(db, { workOrderId, tenantId, toStatus: "ACCEPTED", changedBy }),
    ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("findUnique'i tenant izolasyonuyla çağırır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, tenantId, status: "DRAFT" });

    await transitionWorkOrderStatus(db, {
      workOrderId,
      tenantId,
      toStatus: "ACCEPTED",
      changedBy,
    });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: workOrderId, tenantId } });
  });

  it("geçersiz geçişte InvalidWorkOrderTransitionError fırlatır, update/audit log yazılmaz", async () => {
    const { db, findUnique, update, create } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, tenantId, status: "DRAFT" });

    await expect(
      transitionWorkOrderStatus(db, { workOrderId, tenantId, toStatus: "CLOSED", changedBy }),
    ).rejects.toBeInstanceOf(InvalidWorkOrderTransitionError);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("geçerli geçişte durumu günceller ve audit log kaydı yazar (kim/ne zaman/önceki-yeni durum)", async () => {
    const { db, findUnique, update, create } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, tenantId, status: "DRAFT" });

    await transitionWorkOrderStatus(db, {
      workOrderId,
      tenantId,
      toStatus: "ACCEPTED",
      changedBy,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: workOrderId },
      data: { status: "ACCEPTED" },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        tenantId,
        workOrderId,
        fromStatus: "DRAFT",
        toStatus: "ACCEPTED",
        changedBy,
      },
    });
  });

  it("audit log her zaman update'ten sonra yazılır (sıralama garantisi)", async () => {
    const { db, findUnique, update, create } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, tenantId, status: "IN_PROGRESS" });
    const callOrder: string[] = [];
    update.mockImplementation(() => {
      callOrder.push("update");
      return Promise.resolve();
    });
    create.mockImplementation(() => {
      callOrder.push("auditLog");
      return Promise.resolve();
    });

    await transitionWorkOrderStatus(db, {
      workOrderId,
      tenantId,
      toStatus: "AWAITING_PARTS",
      changedBy,
    });

    expect(callOrder).toEqual(["update", "auditLog"]);
  });
});
