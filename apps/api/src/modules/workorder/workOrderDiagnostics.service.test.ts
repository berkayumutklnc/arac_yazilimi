import { describe, expect, it, vi } from "vitest";
import {
  addDiagnosticReport,
  listDiagnosticReports,
  type WorkOrderDiagnosticsDb,
  type DiagnosticReportDiagClient,
} from "./workOrderDiagnostics.service.js";
import { WorkOrderNotFoundError } from "./workOrderTransition.service.js";

const workOrderId = "wo-1";

function createMockDb() {
  const workOrderFindUnique = vi.fn<WorkOrderDiagnosticsDb["workOrder"]["findUnique"]>();
  const create = vi.fn<WorkOrderDiagnosticsDb["workOrderDiagnosticReport"]["create"]>();
  const findMany = vi.fn<WorkOrderDiagnosticsDb["workOrderDiagnosticReport"]["findMany"]>();
  const db: WorkOrderDiagnosticsDb = {
    workOrder: { findUnique: workOrderFindUnique },
    workOrderDiagnosticReport: { create, findMany },
  };
  return { db, workOrderFindUnique, create, findMany };
}

function createMockDiagClient() {
  const parseDtcFile = vi.fn<DiagnosticReportDiagClient["parseDtcFile"]>();
  const analyzeWotFile = vi.fn<DiagnosticReportDiagClient["analyzeWotFile"]>();
  const diagClient: DiagnosticReportDiagClient = { parseDtcFile, analyzeWotFile };
  return { diagClient, parseDtcFile, analyzeWotFile };
}

describe("addDiagnosticReport", () => {
  it("iş emri bulunamazsa WorkOrderNotFoundError fırlatır, diag-service çağrılmaz", async () => {
    const { db, workOrderFindUnique, create } = createMockDb();
    workOrderFindUnique.mockResolvedValue(null);
    const { diagClient, parseDtcFile } = createMockDiagClient();

    await expect(
      addDiagnosticReport(db, diagClient, {
        workOrderId,
        reportType: "DTC",
        fileName: "log.txt",
        fileBuffer: Buffer.from("x"),
        uploadedBy: "user-1",
      }),
    ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    expect(parseDtcFile).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("DTC rapor tipinde parseDtcFile çağrılır, sonuç kaydedilir", async () => {
    const { db, workOrderFindUnique, create } = createMockDb();
    workOrderFindUnique.mockResolvedValue({ id: workOrderId });
    const { diagClient, parseDtcFile } = createMockDiagClient();
    const dtcResult = { matches: [], unknown_codes: ["P9999"] };
    parseDtcFile.mockResolvedValue(dtcResult);
    create.mockResolvedValue({
      id: "report-1",
      workOrderId,
      reportType: "DTC",
      fileName: "log.txt",
      result: dtcResult,
      uploadedBy: "user-1",
      createdAt: new Date("2026-01-01"),
    });

    const result = await addDiagnosticReport(db, diagClient, {
      workOrderId,
      reportType: "DTC",
      fileName: "log.txt",
      fileBuffer: Buffer.from("P9999\n"),
      uploadedBy: "user-1",
    });

    expect(parseDtcFile).toHaveBeenCalledWith(Buffer.from("P9999\n"), "log.txt");
    expect(create).toHaveBeenCalledWith({
      data: { workOrderId, reportType: "DTC", fileName: "log.txt", result: dtcResult, uploadedBy: "user-1" },
    });
    expect(result.id).toBe("report-1");
  });

  it("WOT rapor tipinde analyzeWotFile çağrılır, sonuç kaydedilir", async () => {
    const { db, workOrderFindUnique, create } = createMockDb();
    workOrderFindUnique.mockResolvedValue({ id: workOrderId });
    const { diagClient, analyzeWotFile } = createMockDiagClient();
    const wotResult = { row_count: 10, findings: [] };
    analyzeWotFile.mockResolvedValue(wotResult);
    create.mockResolvedValue({
      id: "report-2",
      workOrderId,
      reportType: "WOT",
      fileName: "wot.csv",
      result: wotResult,
      uploadedBy: "user-2",
      createdAt: new Date("2026-01-02"),
    });

    await addDiagnosticReport(db, diagClient, {
      workOrderId,
      reportType: "WOT",
      fileName: "wot.csv",
      fileBuffer: Buffer.from("csv"),
      uploadedBy: "user-2",
    });

    expect(analyzeWotFile).toHaveBeenCalledWith(Buffer.from("csv"), "wot.csv");
    expect(create).toHaveBeenCalledWith({
      data: { workOrderId, reportType: "WOT", fileName: "wot.csv", result: wotResult, uploadedBy: "user-2" },
    });
  });

  it("diag-service hata fırlatırsa (ör. DiagServiceUnavailableError) olduğu gibi yükselir, kayıt oluşmaz", async () => {
    const { db, workOrderFindUnique, create } = createMockDb();
    workOrderFindUnique.mockResolvedValue({ id: workOrderId });
    const { diagClient, parseDtcFile } = createMockDiagClient();
    const diagError = new Error("diag-service kapalı");
    parseDtcFile.mockRejectedValue(diagError);

    await expect(
      addDiagnosticReport(db, diagClient, {
        workOrderId,
        reportType: "DTC",
        fileName: "log.txt",
        fileBuffer: Buffer.from("x"),
        uploadedBy: "user-1",
      }),
    ).rejects.toBe(diagError);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("listDiagnosticReports", () => {
  it("iş emrine ait raporları en yeniden en eskiye sıralı döner", async () => {
    const { db, findMany } = createMockDb();
    findMany.mockResolvedValue([]);

    await listDiagnosticReports(db, workOrderId);

    expect(findMany).toHaveBeenCalledWith({
      where: { workOrderId },
      orderBy: { createdAt: "desc" },
    });
  });
});
