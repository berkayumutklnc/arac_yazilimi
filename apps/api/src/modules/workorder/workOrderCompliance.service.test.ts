import { describe, expect, it, vi } from "vitest";
import { applyServiceTypeToWorkOrder } from "./workOrderCompliance.service.js";

const workOrderId = "wo-1";

describe("applyServiceTypeToWorkOrder", () => {
  it("affectsEnginePower=false ise requiresAitmRegistration açılmaz ve step oluşmaz", async () => {
    const db = {
      workOrder: { update: vi.fn() },
      workOrderComplianceStep: { findMany: vi.fn(), createMany: vi.fn() },
    };

    await applyServiceTypeToWorkOrder(db, workOrderId, {
      id: "svc-1",
      affectsEnginePower: false,
    });

    expect(db.workOrder.update).not.toHaveBeenCalled();
    expect(db.workOrderComplianceStep.createMany).not.toHaveBeenCalled();
  });

  it("affectsEnginePower=true ise requiresAitmRegistration=true olur ve TSE/TÜVTÜRK adımları oluşturulur", async () => {
    const db = {
      workOrder: { update: vi.fn() },
      workOrderComplianceStep: {
        findMany: vi.fn().mockResolvedValue([]),
        createMany: vi.fn(),
      },
    };

    await applyServiceTypeToWorkOrder(db, workOrderId, {
      id: "svc-2",
      affectsEnginePower: true,
    });

    expect(db.workOrder.update).toHaveBeenCalledWith({
      where: { id: workOrderId },
      data: { requiresAitmRegistration: true },
    });
    expect(db.workOrderComplianceStep.createMany).toHaveBeenCalledWith({
      data: [
        { workOrderId, stepName: "TSE ön başvuru" },
        { workOrderId, stepName: "TÜVTÜRK tescil" },
      ],
    });
  });

  it("adımlar zaten varsa tekrar oluşturulmaz (idempotent)", async () => {
    const db = {
      workOrder: { update: vi.fn() },
      workOrderComplianceStep: {
        findMany: vi.fn().mockResolvedValue([
          { stepName: "TSE ön başvuru" },
          { stepName: "TÜVTÜRK tescil" },
        ]),
        createMany: vi.fn(),
      },
    };

    await applyServiceTypeToWorkOrder(db, workOrderId, {
      id: "svc-3",
      affectsEnginePower: true,
    });

    expect(db.workOrder.update).toHaveBeenCalledWith({
      where: { id: workOrderId },
      data: { requiresAitmRegistration: true },
    });
    expect(db.workOrderComplianceStep.createMany).not.toHaveBeenCalled();
  });
});
