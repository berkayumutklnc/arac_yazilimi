import { describe, expect, it, vi } from "vitest";
import {
  addWorkOrderItem,
  removeWorkOrderItem,
  listWorkOrderItems,
  WorkOrderItemsLockedError,
  WorkOrderItemNotFoundError,
  type WorkOrderItemDb,
} from "./workOrderItem.service.js";
import { WorkOrderNotFoundError } from "./workOrderTransition.service.js";

const workOrderId = "wo-1";

function createMockDb() {
  const workOrderFindUnique = vi.fn<WorkOrderItemDb["workOrder"]["findUnique"]>();
  const create = vi.fn<WorkOrderItemDb["workOrderItem"]["create"]>();
  const findMany = vi.fn<WorkOrderItemDb["workOrderItem"]["findMany"]>();
  const findUnique = vi.fn<WorkOrderItemDb["workOrderItem"]["findUnique"]>();
  const del = vi.fn<WorkOrderItemDb["workOrderItem"]["delete"]>();
  const db: WorkOrderItemDb = {
    workOrder: { findUnique: workOrderFindUnique },
    workOrderItem: { create, findMany, findUnique, delete: del },
  };
  return { db, workOrderFindUnique, create, findMany, findUnique, del };
}

describe("addWorkOrderItem", () => {
  it("iş emri bulunamazsa WorkOrderNotFoundError fırlatır, kalem oluşturulmaz", async () => {
    const { db, workOrderFindUnique, create } = createMockDb();
    workOrderFindUnique.mockResolvedValue(null);

    await expect(
      addWorkOrderItem(db, {
        workOrderId,
        itemType: "SERVICE",
        description: "Yağ değişimi",
        quantity: 1,
        unitPriceKurus: 100_00,
        vatRate: "RATE_20",
      }),
    ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    expect(create).not.toHaveBeenCalled();
  });

  it.each(["DELIVERED", "CLOSED", "CANCELLED"] as const)(
    "iş emri %s durumundaysa WorkOrderItemsLockedError fırlatır",
    async (status) => {
      const { db, workOrderFindUnique, create } = createMockDb();
      workOrderFindUnique.mockResolvedValue({ id: workOrderId, status });

      await expect(
        addWorkOrderItem(db, {
          workOrderId,
          itemType: "PART",
          description: "Fren balatası",
          quantity: 2,
          unitPriceKurus: 500_00,
          vatRate: "RATE_20",
        }),
      ).rejects.toBeInstanceOf(WorkOrderItemsLockedError);
      expect(create).not.toHaveBeenCalled();
    },
  );

  it.each(["DRAFT", "ACCEPTED", "IN_PROGRESS", "AWAITING_PARTS", "QUALITY_CHECK"] as const)(
    "iş emri %s durumundayken kalem eklenebilir, tutarlar hesaplanır",
    async (status) => {
      const { db, workOrderFindUnique, create } = createMockDb();
      workOrderFindUnique.mockResolvedValue({ id: workOrderId, status });
      create.mockResolvedValue({
        id: "item-1",
        workOrderId,
        itemType: "SERVICE",
        description: "Yağ değişimi",
        serviceTypeId: null,
        quantity: 2,
        unitPriceKurus: 100_00,
        vatRate: "RATE_20",
        netAmountKurus: 200_00,
        vatAmountKurus: 40_00,
        lineTotalKurus: 240_00,
        createdAt: new Date("2026-01-01"),
      });

      const result = await addWorkOrderItem(db, {
        workOrderId,
        itemType: "SERVICE",
        description: "Yağ değişimi",
        quantity: 2,
        unitPriceKurus: 100_00,
        vatRate: "RATE_20",
      });

      expect(create).toHaveBeenCalledWith({
        data: {
          workOrderId,
          itemType: "SERVICE",
          description: "Yağ değişimi",
          serviceTypeId: null,
          quantity: 2,
          unitPriceKurus: 100_00,
          vatRate: "RATE_20",
          netAmountKurus: 200_00,
          vatAmountKurus: 40_00,
          lineTotalKurus: 240_00,
        },
      });
      expect(result.id).toBe("item-1");
    },
  );

  it("serviceTypeId verilirse olduğu gibi kaydedilir", async () => {
    const { db, workOrderFindUnique, create } = createMockDb();
    workOrderFindUnique.mockResolvedValue({ id: workOrderId, status: "DRAFT" });
    create.mockResolvedValue({
      id: "item-2",
      workOrderId,
      itemType: "SERVICE",
      description: "Stage 1 optimizasyon",
      serviceTypeId: "svc-1",
      quantity: 1,
      unitPriceKurus: 5_000_00,
      vatRate: "RATE_20",
      netAmountKurus: 5_000_00,
      vatAmountKurus: 1_000_00,
      lineTotalKurus: 6_000_00,
      createdAt: new Date("2026-01-01"),
    });

    await addWorkOrderItem(db, {
      workOrderId,
      itemType: "SERVICE",
      description: "Stage 1 optimizasyon",
      serviceTypeId: "svc-1",
      quantity: 1,
      unitPriceKurus: 5_000_00,
      vatRate: "RATE_20",
    });

    expect(create).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining() vitest'te `any` döner (bilinen tip boşluğu).
      data: expect.objectContaining({ serviceTypeId: "svc-1" }),
    });
  });
});

describe("removeWorkOrderItem", () => {
  it("iş emri bulunamazsa WorkOrderNotFoundError fırlatır", async () => {
    const { db, workOrderFindUnique, del } = createMockDb();
    workOrderFindUnique.mockResolvedValue(null);

    await expect(removeWorkOrderItem(db, workOrderId, "item-1")).rejects.toBeInstanceOf(
      WorkOrderNotFoundError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("iş emri kilitliyse WorkOrderItemsLockedError fırlatır", async () => {
    const { db, workOrderFindUnique, del } = createMockDb();
    workOrderFindUnique.mockResolvedValue({ id: workOrderId, status: "DELIVERED" });

    await expect(removeWorkOrderItem(db, workOrderId, "item-1")).rejects.toBeInstanceOf(
      WorkOrderItemsLockedError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("kalem bulunamazsa WorkOrderItemNotFoundError fırlatır", async () => {
    const { db, workOrderFindUnique, findUnique, del } = createMockDb();
    workOrderFindUnique.mockResolvedValue({ id: workOrderId, status: "DRAFT" });
    findUnique.mockResolvedValue(null);

    await expect(removeWorkOrderItem(db, workOrderId, "item-1")).rejects.toBeInstanceOf(
      WorkOrderItemNotFoundError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("kalem başka bir iş emrine aitse WorkOrderItemNotFoundError fırlatır", async () => {
    const { db, workOrderFindUnique, findUnique, del } = createMockDb();
    workOrderFindUnique.mockResolvedValue({ id: workOrderId, status: "DRAFT" });
    findUnique.mockResolvedValue({
      id: "item-1",
      workOrderId: "wo-other",
      itemType: "SERVICE",
      description: "x",
      serviceTypeId: null,
      quantity: 1,
      unitPriceKurus: 100,
      vatRate: "RATE_0",
      netAmountKurus: 100,
      vatAmountKurus: 0,
      lineTotalKurus: 100,
      createdAt: new Date(),
    });

    await expect(removeWorkOrderItem(db, workOrderId, "item-1")).rejects.toBeInstanceOf(
      WorkOrderItemNotFoundError,
    );
    expect(del).not.toHaveBeenCalled();
  });

  it("kalem bu iş emrine aitse silinir", async () => {
    const { db, workOrderFindUnique, findUnique, del } = createMockDb();
    workOrderFindUnique.mockResolvedValue({ id: workOrderId, status: "DRAFT" });
    findUnique.mockResolvedValue({
      id: "item-1",
      workOrderId,
      itemType: "SERVICE",
      description: "x",
      serviceTypeId: null,
      quantity: 1,
      unitPriceKurus: 100,
      vatRate: "RATE_0",
      netAmountKurus: 100,
      vatAmountKurus: 0,
      lineTotalKurus: 100,
      createdAt: new Date(),
    });

    await removeWorkOrderItem(db, workOrderId, "item-1");

    expect(del).toHaveBeenCalledWith({ where: { id: "item-1" } });
  });
});

describe("listWorkOrderItems", () => {
  it("iş emrine ait kalemleri oluşturulma sırasına göre döner", async () => {
    const { db, findMany } = createMockDb();
    findMany.mockResolvedValue([]);

    await listWorkOrderItems(db, workOrderId);

    expect(findMany).toHaveBeenCalledWith({
      where: { workOrderId },
      orderBy: { createdAt: "asc" },
    });
  });
});
