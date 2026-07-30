import { WorkOrderNotFoundError, type WorkOrderRecord } from "./workOrderTransition.service.js";

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
}

// tenantId bilinçli olarak yok — db, request başına tenant-scoped oluşturulur
// (bkz. db/tenantScopedDb.ts, ADR 0006). findUnique dönüş tipi WorkOrderRecord
// kullanıyor (WorkOrderTransitionDb ile aynı) ki AppScopedDb'deki intersection
// çakışmasın — bu servis `status` alanını okumuyor, sadece tip uyumu için var.
export interface WorkOrderComplianceDb {
  workOrder: {
    findUnique: (args: { where: { id: string } }) => Promise<WorkOrderRecord | null>;
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
    where: { id: params.workOrderId },
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
