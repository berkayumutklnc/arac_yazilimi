import { describe, expect, it, vi } from "vitest";
import {
  transitionWorkOrderStatus,
  WorkOrderNotFoundError,
  MissingTransitionReasonError,
  type WorkOrderTransitionDb,
} from "./workOrderTransition.service.js";
import { InvalidWorkOrderTransitionError } from "./workOrderStatus.machine.js";

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
    const { db, findUnique, update, create } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(
      transitionWorkOrderStatus(db, { workOrderId, toStatus: "ACCEPTED", changedBy }),
    ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("findUnique'i yalnızca id ile çağırır — tenant filtresi artık db'ye (scoped extension) gömülü, elle geçilmez", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, status: "DRAFT" });

    await transitionWorkOrderStatus(db, { workOrderId, toStatus: "ACCEPTED", changedBy });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: workOrderId } });
    // toHaveBeenCalledWith, {tenantId: undefined} içeren bir çağrıyı da eşit sayar
    // (undefined-değerli anahtarları görmezden gelir) — asıl kanıt: gerçekten
    // "tenantId" anahtarı YOK, sadece değeri undefined değil.
    const callArgs = findUnique.mock.calls[0]?.[0];
    expect(Object.keys(callArgs?.where ?? {})).toEqual(["id"]);
  });

  it("geçersiz geçişte InvalidWorkOrderTransitionError fırlatır, update/audit log yazılmaz", async () => {
    const { db, findUnique, update, create } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, status: "DRAFT" });

    await expect(
      transitionWorkOrderStatus(db, { workOrderId, toStatus: "CLOSED", changedBy }),
    ).rejects.toBeInstanceOf(InvalidWorkOrderTransitionError);
    expect(update).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("geçerli geçişte durumu günceller ve audit log kaydı yazar (kim/ne zaman/önceki-yeni durum) — tenantId artık extension'dan gelir", async () => {
    const { db, findUnique, update, create } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, status: "DRAFT" });

    await transitionWorkOrderStatus(db, { workOrderId, toStatus: "ACCEPTED", changedBy });

    expect(update).toHaveBeenCalledWith({
      where: { id: workOrderId },
      data: { status: "ACCEPTED" },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        workOrderId,
        fromStatus: "DRAFT",
        toStatus: "ACCEPTED",
        reason: null,
        changedBy,
      },
    });
    const auditArgs = create.mock.calls[0]?.[0];
    expect(Object.keys(auditArgs?.data ?? {}).sort()).toEqual(
      ["changedBy", "fromStatus", "reason", "toStatus", "workOrderId"].sort(),
    );
  });

  it("audit log her zaman update'ten sonra yazılır (sıralama garantisi)", async () => {
    const { db, findUnique, update, create } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, status: "IN_PROGRESS" });
    const callOrder: string[] = [];
    update.mockImplementation(() => {
      callOrder.push("update");
      return Promise.resolve();
    });
    create.mockImplementation(() => {
      callOrder.push("auditLog");
      return Promise.resolve();
    });

    await transitionWorkOrderStatus(db, { workOrderId, toStatus: "AWAITING_PARTS", changedBy });

    expect(callOrder).toEqual(["update", "auditLog"]);
  });

  describe("rework (QUALITY_CHECK -> IN_PROGRESS) ve iptal (-> CANCELLED)", () => {
    it("rework reason olmadan denenirse MissingTransitionReasonError fırlatır, update/audit yazılmaz", async () => {
      const { db, findUnique, update, create } = createMockDb();
      findUnique.mockResolvedValue({ id: workOrderId, status: "QUALITY_CHECK" });

      await expect(
        transitionWorkOrderStatus(db, { workOrderId, toStatus: "IN_PROGRESS", changedBy }),
      ).rejects.toBeInstanceOf(MissingTransitionReasonError);
      expect(update).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("rework reason'lı verilirse başarılı olur, audit log reason'ı taşır", async () => {
      const { db, findUnique, update, create } = createMockDb();
      findUnique.mockResolvedValue({ id: workOrderId, status: "QUALITY_CHECK" });

      await transitionWorkOrderStatus(db, {
        workOrderId,
        toStatus: "IN_PROGRESS",
        changedBy,
        reason: "Boya kalitesi kontrolden geçmedi",
      });

      expect(update).toHaveBeenCalledWith({ where: { id: workOrderId }, data: { status: "IN_PROGRESS" } });
      expect(create).toHaveBeenCalledWith({
        data: {
          workOrderId,
          fromStatus: "QUALITY_CHECK",
          toStatus: "IN_PROGRESS",
          reason: "Boya kalitesi kontrolden geçmedi",
          changedBy,
        },
      });
    });

    it("iptal reason olmadan denenirse MissingTransitionReasonError fırlatır, update/audit yazılmaz", async () => {
      const { db, findUnique, update, create } = createMockDb();
      findUnique.mockResolvedValue({ id: workOrderId, status: "DRAFT" });

      await expect(
        transitionWorkOrderStatus(db, { workOrderId, toStatus: "CANCELLED", changedBy }),
      ).rejects.toBeInstanceOf(MissingTransitionReasonError);
      expect(update).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });

    it("iptal reason'lı verilirse başarılı olur, audit log reason'ı taşır", async () => {
      const { db, findUnique, update, create } = createMockDb();
      findUnique.mockResolvedValue({ id: workOrderId, status: "IN_PROGRESS" });

      await transitionWorkOrderStatus(db, {
        workOrderId,
        toStatus: "CANCELLED",
        changedBy,
        reason: "Müşteri talebi",
      });

      expect(update).toHaveBeenCalledWith({ where: { id: workOrderId }, data: { status: "CANCELLED" } });
      expect(create).toHaveBeenCalledWith({
        data: {
          workOrderId,
          fromStatus: "IN_PROGRESS",
          toStatus: "CANCELLED",
          reason: "Müşteri talebi",
          changedBy,
        },
      });
    });

    it("DELIVERED'dan iptal geçersizdir (reason verilse bile) — InvalidWorkOrderTransitionError", async () => {
      const { db, findUnique, update, create } = createMockDb();
      findUnique.mockResolvedValue({ id: workOrderId, status: "DELIVERED" });

      await expect(
        transitionWorkOrderStatus(db, {
          workOrderId,
          toStatus: "CANCELLED",
          changedBy,
          reason: "Müşteri talebi",
        }),
      ).rejects.toBeInstanceOf(InvalidWorkOrderTransitionError);
      expect(update).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });
});
