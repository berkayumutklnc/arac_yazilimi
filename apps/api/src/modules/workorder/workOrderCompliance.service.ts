const DEFAULT_COMPLIANCE_STEPS = ["TSE ön başvuru", "TÜVTÜRK tescil"] as const;

interface ServiceTypeLite {
  id: string;
  affectsEnginePower: boolean;
}

interface ComplianceStepRecord {
  stepName: string;
}

export interface WorkOrderComplianceDb {
  workOrder: {
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
  workOrderId: string,
  serviceType: ServiceTypeLite,
): Promise<void> {
  if (!serviceType.affectsEnginePower) {
    return;
  }

  await db.workOrder.update({
    where: { id: workOrderId },
    data: { requiresAitmRegistration: true },
  });

  const existingSteps = await db.workOrderComplianceStep.findMany({
    where: { workOrderId },
  });
  const existingNames = new Set(existingSteps.map((step) => step.stepName));
  const missingSteps = DEFAULT_COMPLIANCE_STEPS.filter((name) => !existingNames.has(name));

  if (missingSteps.length > 0) {
    await db.workOrderComplianceStep.createMany({
      data: missingSteps.map((stepName) => ({ workOrderId, stepName })),
    });
  }
}
