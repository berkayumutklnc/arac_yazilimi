import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { WorkOrderTransitionDb } from "./workOrderTransition.service.js";

const tenantId = "tenant-1";
const workOrderId = "wo-1";

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

describe("PATCH /work-orders/:id/status", () => {
  it("geçerli geçişte 200 döner", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, tenantId, status: "DRAFT" });
    const app = buildApp(db);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      payload: { tenantId, toStatus: "ACCEPTED", changedBy: "user-1" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("geçersiz geçişte 409 döner", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue({ id: workOrderId, tenantId, status: "DRAFT" });
    const app = buildApp(db);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      payload: { tenantId, toStatus: "CLOSED", changedBy: "user-1" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ from: "DRAFT", to: "CLOSED" });
  });

  it("iş emri bulunamazsa 404 döner", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(null);
    const app = buildApp(db);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      payload: { tenantId, toStatus: "ACCEPTED", changedBy: "user-1" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("geçersiz gövde (bilinmeyen toStatus) 400 döner", async () => {
    const { db } = createMockDb();
    const app = buildApp(db);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      payload: { tenantId, toStatus: "NOT_A_STATUS", changedBy: "user-1" },
    });

    expect(response.statusCode).toBe(400);
  });
});
