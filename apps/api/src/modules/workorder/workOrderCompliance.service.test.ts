import { describe, expect, it, vi } from "vitest";
import { applyServiceTypeToWorkOrder, type WorkOrderComplianceDb } from "./workOrderCompliance.service.js";
import { WorkOrderNotFoundError } from "./workOrderTransition.service.js";

const workOrderId = "wo-1";

function createMockDb() {
  const findUnique = vi.fn<WorkOrderComplianceDb["workOrder"]["findUnique"]>();
  findUnique.mockResolvedValue({ id: workOrderId, status: "DRAFT" });
  const update = vi.fn<WorkOrderComplianceDb["workOrder"]["update"]>();
  const findMany = vi.fn<WorkOrderComplianceDb["workOrderComplianceStep"]["findMany"]>();
  findMany.mockResolvedValue([]);
  const createMany = vi.fn<WorkOrderComplianceDb["workOrderComplianceStep"]["createMany"]>();
  const db: WorkOrderComplianceDb = {
    workOrder: { findUnique, update },
    workOrderComplianceStep: { findMany, createMany },
  };
  return { db, findUnique, update, findMany, createMany };
}

describe("applyServiceTypeToWorkOrder", () => {
  it("workOrderId çağıranın tenant'ına ait değilse WorkOrderNotFoundError fırlatır (tenant izolasyonu)", async () => {
    const { db, findUnique, update, createMany } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(
      applyServiceTypeToWorkOrder(db, { workOrderId }, { id: "svc-1", affectsEnginePower: true }),
    ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    expect(update).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("affectsEnginePower=false ise requiresAitmRegistration açılmaz ve step oluşmaz", async () => {
    const { db, findUnique, update, createMany } = createMockDb();

    await applyServiceTypeToWorkOrder(db, { workOrderId }, { id: "svc-1", affectsEnginePower: false });

    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("affectsEnginePower=true ise requiresAitmRegistration=true olur ve TSE/TÜVTÜRK adımları oluşturulur — tenantId artık extension'dan gelir", async () => {
    const { db, findUnique, update, createMany } = createMockDb();

    await applyServiceTypeToWorkOrder(db, { workOrderId }, { id: "svc-2", affectsEnginePower: true });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: workOrderId } });
    const findArgs = findUnique.mock.calls[0]?.[0];
    expect(Object.keys(findArgs?.where ?? {})).toEqual(["id"]);

    expect(update).toHaveBeenCalledWith({
      where: { id: workOrderId },
      data: { requiresAitmRegistration: true },
    });
    expect(createMany).toHaveBeenCalledWith({
      data: [
        { workOrderId, stepName: "TSE ön başvuru" },
        { workOrderId, stepName: "TÜVTÜRK tescil" },
      ],
    });
  });

  it("adımlar zaten varsa tekrar oluşturulmaz (idempotent)", async () => {
    const { db, findMany, update, createMany } = createMockDb();
    findMany.mockResolvedValue([
      { stepName: "TSE ön başvuru" },
      { stepName: "TÜVTÜRK tescil" },
    ]);

    await applyServiceTypeToWorkOrder(db, { workOrderId }, { id: "svc-3", affectsEnginePower: true });

    expect(update).toHaveBeenCalledWith({
      where: { id: workOrderId },
      data: { requiresAitmRegistration: true },
    });
    expect(createMany).not.toHaveBeenCalled();
  });
});
