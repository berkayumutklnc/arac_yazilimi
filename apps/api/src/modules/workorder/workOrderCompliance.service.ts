import { WorkOrderNotFoundError } from "./workOrderTransition.service.js";

const DEFAULT_COMPLIANCE_STEPS = ["TSE ön başvuru", "TÜVTÜRK tescil"] as const;

interface ServiceTypeLite {
  id: string;
  affectsEnginePower: boolean;
}

interface ComplianceStepRecord {
  stepName: string;
}

export interface ApplyServiceTypeParams {
  workOrderId: string;
  tenantId: string;
}

export interface WorkOrderComplianceDb {
  // Güvenlik (bkz. docs/security-audit.md, KRİTİK-3): workOrderId'nin
  // tenantId'ye ait olduğu doğrulanmadan hiçbir güncelleme yapılmaz.
  workOrder: {
    findUnique: (args: {
      where: { id: string; tenantId: string };
    }) => Promise<{ id: string } | null>;
    update: (args: {
      where: { id: string };
      data: { requiresAitmRegistration: boolean };
    }) => Promise<unknown>;
  };
  workOrderComplianceStep: {
    findMany: (args: { where: { workOrderId: string } }) => Promise<ComplianceStepRecord[]>;
    createMany: (args: {
      data: { workOrderId: string; stepName: string }[];
    }) => Promise<unknown>;
  };
}

export async function applyServiceTypeToWorkOrder(
  db: WorkOrderComplianceDb,
  params: ApplyServiceTypeParams,
  serviceType: ServiceTypeLite,
): Promise<void> {
  if (!serviceType.affectsEnginePower) {
    return;
  }

  const workOrder = await db.workOrder.findUnique({
    where: { id: params.workOrderId, tenantId: params.tenantId },
  });
  if (!workOrder) {
    throw new WorkOrderNotFoundError(params.workOrderId);
  }

  await db.workOrder.update({
    where: { id: workOrder.id },
    data: { requiresAitmRegistration: true },
  });

  const existingSteps = await db.workOrderComplianceStep.findMany({
    where: { workOrderId: workOrder.id },
  });
  const existingNames = new Set(existingSteps.map((step) => step.stepName));
  const missingSteps = DEFAULT_COMPLIANCE_STEPS.filter((name) => !existingNames.has(name));

  if (missingSteps.length > 0) {
    await db.workOrderComplianceStep.createMany({
      data: missingSteps.map((stepName) => ({ workOrderId: workOrder.id, stepName })),
    });
  }
}
