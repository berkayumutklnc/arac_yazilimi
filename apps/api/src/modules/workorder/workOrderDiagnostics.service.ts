import type { DiagnosticReportType } from "../../generated/prisma/enums.js";
import { WorkOrderNotFoundError } from "./workOrderTransition.service.js";
import type { DiagServiceClient } from "../../diagService/diagServiceClient.js";

export interface DiagnosticReportRecord {
  id: string;
  workOrderId: string;
  reportType: DiagnosticReportType;
  fileName: string;
  // Sunucu diag-service'ten aldığı yanıtı zod ile doğruladıktan SONRA burada
  // saklar (bkz. diagServiceClient.ts) — bu arayüzün kendisi bir daha
  // doğrulama yapmaz, yalnızca zaten-doğrulanmış veriyi taşır.
  result: unknown;
  uploadedBy: string;
  createdAt: Date;
}

// tenantId bilinçli olarak yok — db, request başına tenant-scoped oluşturulur
// (bkz. db/tenantScopedDb.ts, ADR 0006).
export interface WorkOrderDiagnosticsDb {
  workOrder: {
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string } | null>;
  };
  workOrderDiagnosticReport: {
    create: (args: {
      data: {
        workOrderId: string;
        reportType: DiagnosticReportType;
        fileName: string;
        result: unknown;
        uploadedBy: string;
      };
    }) => Promise<DiagnosticReportRecord>;
    findMany: (args: {
      where: { workOrderId: string };
      orderBy: { createdAt: "desc" };
    }) => Promise<DiagnosticReportRecord[]>;
  };
}

// Servis yalnızca gerçekte kullandığı iki metodu görür — testte tam
// DiagServiceClient inşa etmeye gerek kalmaz.
export type DiagnosticReportDiagClient = Pick<DiagServiceClient, "parseDtcFile" | "analyzeWotFile">;

export interface AddDiagnosticReportParams {
  workOrderId: string;
  reportType: DiagnosticReportType;
  fileName: string;
  fileBuffer: Buffer;
  uploadedBy: string;
}

export async function addDiagnosticReport(
  db: WorkOrderDiagnosticsDb,
  diagClient: DiagnosticReportDiagClient,
  params: AddDiagnosticReportParams,
): Promise<DiagnosticReportRecord> {
  const workOrder = await db.workOrder.findUnique({ where: { id: params.workOrderId } });
  if (!workOrder) {
    throw new WorkOrderNotFoundError(params.workOrderId);
  }

  // DiagServiceUnavailableError/DiagServiceRequestError/DiagServiceContractError
  // burada YAKALANMAZ — route katmanına kadar olduğu gibi yükselir ve orada
  // HTTP durum koduna eşlenir (bkz. workOrder.routes.ts, ADR 0009).
  const result =
    params.reportType === "DTC"
      ? await diagClient.parseDtcFile(params.fileBuffer, params.fileName)
      : await diagClient.analyzeWotFile(params.fileBuffer, params.fileName);

  return db.workOrderDiagnosticReport.create({
    data: {
      workOrderId: workOrder.id,
      reportType: params.reportType,
      fileName: params.fileName,
      result,
      uploadedBy: params.uploadedBy,
    },
  });
}

export async function listDiagnosticReports(
  db: WorkOrderDiagnosticsDb,
  workOrderId: string,
): Promise<DiagnosticReportRecord[]> {
  return db.workOrderDiagnosticReport.findMany({
    where: { workOrderId },
    orderBy: { createdAt: "desc" },
  });
}
