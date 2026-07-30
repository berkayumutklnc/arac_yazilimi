import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { AppScopedDb } from "../../db/tenantScopedDb.js";
import { signAccessToken } from "../../modules/auth/authToken.js";
import { Role } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { WorkOrderStatus } from "./workOrderStatus.machine.js";
import type { DiagnosticReportDiagClient } from "./workOrderDiagnostics.service.js";
import type { WorkOrderItemRecord } from "./workOrderItem.service.js";
import type { InvoiceGenerationDb } from "../billing/invoiceGeneration.service.js";
import {
  DiagServiceUnavailableError,
  DiagServiceContractError,
} from "../../diagService/diagServiceClient.js";

const jwtSecret = "test-secret";
const tenantId = "tenant-1";
const workOrderId = "wo-1";
const vehicleId = "vehicle-1";

// AppScopedDb'nin kesişimi workOrder.findUnique'i artık WorkOrderCrudDb'nin
// (bkz. workOrderCrud.service.ts) daha geniş şekliyle de birleştiriyor —
// gerçek Prisma çağrısı zaten tüm satırı döner, bu yüzden fake de öyle davranmalı.
function workOrderRow(status: WorkOrderStatus, overrides: Record<string, unknown> = {}) {
  return {
    id: workOrderId,
    vehicleId,
    status,
    requiresAitmRegistration: false,
    createdAt: new Date("2026-01-01"),
    engineerId: null,
    closedAt: null,
    ...overrides,
  };
}

function createMockScopedDb() {
  const findUnique = vi.fn<AppScopedDb["workOrder"]["findUnique"]>();
  const update = vi.fn<AppScopedDb["workOrder"]["update"]>();
  const create = vi.fn<AppScopedDb["workOrder"]["create"]>();
  const findMany = vi.fn<AppScopedDb["workOrder"]["findMany"]>();
  const vehicleFindUnique = vi.fn<AppScopedDb["vehicle"]["findUnique"]>();
  const auditCreate = vi.fn<AppScopedDb["workOrderStatusAuditLog"]["create"]>();
  const auditFindMany = vi.fn<AppScopedDb["workOrderStatusAuditLog"]["findMany"]>();
  auditFindMany.mockResolvedValue([]);
  const diagnosticReportCreate = vi.fn<AppScopedDb["workOrderDiagnosticReport"]["create"]>();
  const diagnosticReportFindMany = vi.fn<AppScopedDb["workOrderDiagnosticReport"]["findMany"]>();
  diagnosticReportFindMany.mockResolvedValue([]);
  const itemCreate = vi.fn<AppScopedDb["workOrderItem"]["create"]>();
  const itemFindMany = vi.fn<AppScopedDb["workOrderItem"]["findMany"]>();
  itemFindMany.mockResolvedValue([]);
  const itemFindUnique = vi.fn<AppScopedDb["workOrderItem"]["findUnique"]>();
  const itemDelete = vi.fn<AppScopedDb["workOrderItem"]["delete"]>();
  const invoiceCreate = vi.fn<InvoiceGenerationDb["invoice"]["create"]>();
  const scopedDb = {
    vehicle: { findUnique: vehicleFindUnique },
    workOrder: { findUnique, update, create, findMany },
    workOrderStatusAuditLog: { create: auditCreate, findMany: auditFindMany },
    workOrderDiagnosticReport: { create: diagnosticReportCreate, findMany: diagnosticReportFindMany },
    workOrderItem: { create: itemCreate, findMany: itemFindMany, findUnique: itemFindUnique, delete: itemDelete },
    invoice: { create: invoiceCreate },
  } as unknown as AppScopedDb;
  return {
    scopedDb,
    findUnique,
    update,
    create,
    findMany,
    vehicleFindUnique,
    auditCreate,
    auditFindMany,
    diagnosticReportCreate,
    diagnosticReportFindMany,
    itemCreate,
    itemFindMany,
    itemFindUnique,
    itemDelete,
    invoiceCreate,
  };
}

// authPreHandler, request.tenantDb'yi prisma.$extends(...) çağırarak üretir.
// Gerçek Prisma extension pipeline'ını (zaten tenantScopedDb.test.ts'te ayrıca
// test edildi) tekrar kurmak yerine, $extends'i doğrudan mock scoped db'yi
// döndürecek şekilde sahteliyoruz — bu test yalnızca route KABLOLAMASINI
// (auth zorunluluğu, durum kodu eşlemesi) doğruluyor.
// DELIVERED geçişi prisma.$transaction'ı DOĞRUDAN kullanır (bkz.
// invoiceTransactional.ts) — tx olarak AYNI scopedDb model mock'larını taşıyan
// bir nesne alır, gerçek Postgres transaction semantiği burada test edilmez
// (yalnızca route KABLOLAMASI, bkz. invoiceTransactional.test.ts).
function createFakePrisma(scopedDb: AppScopedDb): PrismaClient {
  return {
    $extends: () => scopedDb,
    $transaction: (fn: (tx: unknown) => unknown) => fn(scopedDb),
  } as unknown as PrismaClient;
}

// Bu route'ların çoğu storage/diagServiceClient kullanmıyor — buildApp'in
// imzası gerektirdiği için (bkz. ecuFile.routes.ts) yalnızca mekanik bir fake
// geçiriliyor; diagnostic-report testleri kendi diagServiceClient fake'ini geçirir.
const unusedStorage = {
  createPresignedUploadUrl: vi.fn(),
  readObjectSha256: vi.fn(),
  createPresignedDownloadUrl: vi.fn(),
};

function createMockDiagServiceClient() {
  const parseDtcFile = vi.fn();
  const analyzeWotFile = vi.fn();
  return { diagServiceClient: { parseDtcFile, analyzeWotFile }, parseDtcFile, analyzeWotFile };
}

const unusedEmailSender = { sendInvitationEmail: vi.fn() };

function buildTestApp(
  scopedDb: AppScopedDb,
  diagServiceClient: DiagnosticReportDiagClient = createMockDiagServiceClient().diagServiceClient,
) {
  const prisma = createFakePrisma(scopedDb);
  return buildApp(prisma, {
    jwtSecret,
    storage: unusedStorage,
    diagServiceClient,
    emailSender: unusedEmailSender,
    webAppBaseUrl: "https://app.example.test",
  });
}

function authHeader(overrides: { tenantId?: string; role?: Role } = {}) {
  const token = signAccessToken(
    {
      userId: "user-1",
      tenantId: overrides.tenantId ?? tenantId,
      role: overrides.role ?? Role.OWNER,
    },
    jwtSecret,
  );
  return { authorization: `Bearer ${token}` };
}

describe("PATCH /work-orders/:id/status", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      payload: { toStatus: "ACCEPTED" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("geçerli geçişte 200 döner, changedBy authContext'ten (userId) alınır", async () => {
    const { scopedDb, findUnique, auditCreate } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "ACCEPTED" },
    });

    expect(response.statusCode).toBe(200);
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        workOrderId,
        fromStatus: "DRAFT",
        toStatus: "ACCEPTED",
        reason: null,
        changedBy: "user-1",
      },
    });
  });

  it("geçersiz geçişte 409 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "CLOSED" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ from: "DRAFT", to: "CLOSED" });
  });

  it("iş emri bulunamazsa (ör. başka tenant'a aitse) 404 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "ACCEPTED" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("geçersiz gövde (bilinmeyen toStatus) 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "NOT_A_STATUS" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("gövdede tenantId/changedBy gönderilse bile yok sayılır — yalnızca authContext etkilidir", async () => {
    const { scopedDb, findUnique, auditCreate } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    const app = buildTestApp(scopedDb);

    await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: {
        toStatus: "ACCEPTED",
        tenantId: "attacker-supplied-tenant",
        changedBy: "attacker-supplied-user",
      },
    });

    const auditArgs = auditCreate.mock.calls[0]?.[0];
    expect(auditArgs?.data.changedBy).toBe("user-1");
  });

  it("iptal (CANCELLED) reason olmadan denenirse 400 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "CANCELLED" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("iptal (CANCELLED) reason ile 200 döner, audit log reason'ı taşır", async () => {
    const { scopedDb, findUnique, auditCreate } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "CANCELLED", reason: "Müşteri talebi" },
    });

    expect(response.statusCode).toBe(200);
    const auditArgs = auditCreate.mock.calls[0]?.[0];
    expect(auditArgs?.data.reason).toBe("Müşteri talebi");
  });

  it("rework (QUALITY_CHECK -> IN_PROGRESS) reason olmadan denenirse 400 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("QUALITY_CHECK"));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "IN_PROGRESS" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("rework (QUALITY_CHECK -> IN_PROGRESS) reason ile 200 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("QUALITY_CHECK"));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "IN_PROGRESS", reason: "Boya kalitesi kontrolden geçmedi" },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("PATCH /work-orders/:id/status (DELIVERED -> otomatik taslak fatura)", () => {
  it("QUALITY_CHECK -> DELIVERED'da 200 döner, mevcut kalemlerden taslak fatura oluşturulur", async () => {
    const { scopedDb, findUnique, itemFindMany, invoiceCreate, auditCreate } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("QUALITY_CHECK"));
    itemFindMany.mockResolvedValue([
      {
        id: "item-1",
        workOrderId,
        itemType: "SERVICE",
        description: "Stage 1 optimizasyon",
        serviceTypeId: null,
        quantity: 1,
        unitPriceKurus: 5_000_00,
        vatRate: "RATE_20",
        netAmountKurus: 5_000_00,
        vatAmountKurus: 1_000_00,
        lineTotalKurus: 6_000_00,
        createdAt: new Date("2026-01-01"),
      },
    ]);
    invoiceCreate.mockResolvedValue({
      id: "inv-1",
      workOrderId,
      status: "DRAFT",
      invoiceNumber: null,
      issuedAt: null,
      voidedAt: null,
      totalKurus: 6_000_00,
      createdAt: new Date("2026-01-01"),
    });
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "DELIVERED" },
    });

    expect(response.statusCode).toBe(200);
    expect(invoiceCreate).toHaveBeenCalledWith({
      data: {
        workOrderId,
        status: "DRAFT",
        invoiceNumber: null,
        totalKurus: 6_000_00,
        lines: {
          create: [
            {
              description: "Stage 1 optimizasyon",
              quantity: 1,
              unitPriceKurus: 5_000_00,
              vatRate: "RATE_20",
              netAmountKurus: 5_000_00,
              vatAmountKurus: 1_000_00,
              lineTotalKurus: 6_000_00,
            },
          ],
        },
        tenantId,
      },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        workOrderId,
        fromStatus: "QUALITY_CHECK",
        toStatus: "DELIVERED",
        reason: null,
        changedBy: "user-1",
        tenantId,
      },
    });
  });

  it("kalemsiz iş emrinde ₺0 taslak fatura oluşturur, teslimatı engellemez", async () => {
    const { scopedDb, findUnique, itemFindMany, invoiceCreate } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("QUALITY_CHECK"));
    itemFindMany.mockResolvedValue([]);
    invoiceCreate.mockResolvedValue({
      id: "inv-1",
      workOrderId,
      status: "DRAFT",
      invoiceNumber: null,
      issuedAt: null,
      voidedAt: null,
      totalKurus: 0,
      createdAt: new Date("2026-01-01"),
    });
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "DELIVERED" },
    });

    expect(response.statusCode).toBe(200);
    expect(invoiceCreate).toHaveBeenCalledWith({
      data: { workOrderId, status: "DRAFT", invoiceNumber: null, totalKurus: 0, lines: { create: [] }, tenantId },
    });
  });

  it("geçersiz geçişte (ör. DRAFT'tan doğrudan DELIVERED) 409 döner, fatura oluşmaz", async () => {
    const { scopedDb, findUnique, invoiceCreate } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "DELIVERED" },
    });

    expect(response.statusCode).toBe(409);
    expect(invoiceCreate).not.toHaveBeenCalled();
  });

  it("iş emri bulunamazsa 404 döner", async () => {
    const { scopedDb, findUnique, invoiceCreate } = createMockScopedDb();
    findUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${workOrderId}/status`,
      headers: authHeader(),
      payload: { toStatus: "DELIVERED" },
    });

    expect(response.statusCode).toBe(404);
    expect(invoiceCreate).not.toHaveBeenCalled();
  });
});

describe("POST /work-orders", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "POST", url: "/work-orders", payload: { vehicleId } });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü iş emri oluşturamaz — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/work-orders",
      headers: authHeader({ role: Role.DEALER }),
      payload: { vehicleId },
    });

    expect(response.statusCode).toBe(403);
  });

  it("geçersiz gövde (vehicleId eksik) 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/work-orders",
      headers: authHeader(),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("araç bu tenant'a ait değilse/yoksa 404 döner", async () => {
    const { scopedDb, vehicleFindUnique } = createMockScopedDb();
    vehicleFindUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/work-orders",
      headers: authHeader(),
      payload: { vehicleId },
    });

    expect(response.statusCode).toBe(404);
  });

  it("geçerli araçla 201 döner", async () => {
    const { scopedDb, vehicleFindUnique, create } = createMockScopedDb();
    vehicleFindUnique.mockResolvedValue({ id: vehicleId });
    create.mockResolvedValue({ id: workOrderId });
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/work-orders",
      headers: authHeader(),
      payload: { vehicleId },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ id: workOrderId });
  });
});

describe("GET /work-orders", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: "/work-orders" });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü iş emri listesini göremez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: "/work-orders",
      headers: authHeader({ role: Role.DEALER }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("tenant-scoped iş emri listesini 200 ile döner", async () => {
    const { scopedDb, findMany } = createMockScopedDb();
    findMany.mockResolvedValue([workOrderRow("DRAFT")]);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: "/work-orders", headers: authHeader() });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ ...workOrderRow("DRAFT"), createdAt: "2026-01-01T00:00:00.000Z" }] });
  });
});

describe("GET /work-orders/:id", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: `/work-orders/${workOrderId}` });

    expect(response.statusCode).toBe(401);
  });

  it("iş emri bulunamazsa 404 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${workOrderId}`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(404);
  });

  it("iş emri + durum geçmişini 200 ile döner", async () => {
    const { scopedDb, findUnique, auditFindMany } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("ACCEPTED"));
    auditFindMany.mockResolvedValue([
      {
        fromStatus: "DRAFT",
        toStatus: "ACCEPTED",
        reason: null,
        changedBy: "user-1",
        changedAt: new Date("2026-01-02"),
      },
    ]);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${workOrderId}`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    const body: { status: string; statusHistory: unknown[] } = response.json();
    expect(body.status).toBe("ACCEPTED");
    expect(body.statusHistory).toHaveLength(1);
  });
});

// @fastify/multipart gerçek bir multipart/form-data gövdesi bekler — inject()
// bunu manuel oluşturuyor (reportType dosyadan ÖNCE eklenir, route bu sırayı
// varsayıyor — bkz. workOrder.routes.ts yorumu).
function buildMultipartBody(reportType: string | undefined, file: { filename: string; content: Buffer } | null) {
  const boundary = "----testboundary123456";
  const chunks: Buffer[] = [];
  if (reportType !== undefined) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="reportType"\r\n\r\n${reportType}\r\n`),
    );
  }
  if (file) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
    );
    chunks.push(file.content);
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` };
}

describe("POST /work-orders/:id/diagnostic-reports", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);
    const { body, contentType } = buildMultipartBody("DTC", { filename: "log.txt", content: Buffer.from("x") });

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: { "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü rapor yükleyemez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);
    const { body, contentType } = buildMultipartBody("DTC", { filename: "log.txt", content: Buffer.from("x") });

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: { ...authHeader({ role: Role.DEALER }), "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(403);
  });

  it("dosya yoksa 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);
    const { body, contentType } = buildMultipartBody("DTC", null);

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: { ...authHeader(), "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
  });

  it("reportType eksik/geçersizse 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);
    const { body, contentType } = buildMultipartBody("NOT_A_TYPE", { filename: "log.txt", content: Buffer.from("x") });

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: { ...authHeader(), "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(400);
  });

  it("iş emri bulunamazsa 404 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);
    const { body, contentType } = buildMultipartBody("DTC", { filename: "log.txt", content: Buffer.from("x") });

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: { ...authHeader(), "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(404);
  });

  it("diag-service'e ulaşılamazsa 503 döner (kuyruğa alma yok, net hata)", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    const { diagServiceClient, parseDtcFile } = createMockDiagServiceClient();
    parseDtcFile.mockRejectedValue(new DiagServiceUnavailableError(new Error("ECONNREFUSED")));
    const app = buildTestApp(scopedDb, diagServiceClient);
    const { body, contentType } = buildMultipartBody("DTC", { filename: "log.txt", content: Buffer.from("x") });

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: { ...authHeader(), "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(503);
  });

  it("diag-service sözleşme dışı bir yanıt verirse 502 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    const { diagServiceClient, parseDtcFile } = createMockDiagServiceClient();
    parseDtcFile.mockRejectedValue(new DiagServiceContractError(new Error("zod")));
    const app = buildTestApp(scopedDb, diagServiceClient);
    const { body, contentType } = buildMultipartBody("DTC", { filename: "log.txt", content: Buffer.from("x") });

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: { ...authHeader(), "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(502);
  });

  it("geçerli DTC yüklemesinde 201 döner ve parseDtcFile çağrılır", async () => {
    const { scopedDb, findUnique, diagnosticReportCreate } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    diagnosticReportCreate.mockResolvedValue({
      id: "report-1",
      workOrderId,
      reportType: "DTC",
      fileName: "log.txt",
      result: { matches: [], unknown_codes: [] },
      uploadedBy: "user-1",
      createdAt: new Date("2026-01-01"),
    });
    const { diagServiceClient, parseDtcFile } = createMockDiagServiceClient();
    parseDtcFile.mockResolvedValue({ matches: [], unknown_codes: [] });
    const app = buildTestApp(scopedDb, diagServiceClient);
    const { body, contentType } = buildMultipartBody("DTC", { filename: "log.txt", content: Buffer.from("P0300\n") });

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: { ...authHeader(), "content-type": contentType },
      payload: body,
    });

    expect(response.statusCode).toBe(201);
    expect(parseDtcFile).toHaveBeenCalledTimes(1);
  });
});

describe("GET /work-orders/:id/diagnostic-reports", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
    });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü göremez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: authHeader({ role: Role.DEALER }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("raporları 200 ile döner", async () => {
    const { scopedDb, diagnosticReportFindMany } = createMockScopedDb();
    diagnosticReportFindMany.mockResolvedValue([
      {
        id: "report-1",
        workOrderId,
        reportType: "WOT",
        fileName: "wot.csv",
        result: { row_count: 5, findings: [] },
        uploadedBy: "user-1",
        createdAt: new Date("2026-01-01"),
      },
    ]);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${workOrderId}/diagnostic-reports`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    const responseBody: { items: unknown[] } = response.json();
    expect(responseBody.items).toHaveLength(1);
    expect(diagnosticReportFindMany).toHaveBeenCalledWith({
      where: { workOrderId },
      orderBy: { createdAt: "desc" },
    });
  });
});

const addItemPayload = {
  itemType: "SERVICE",
  description: "Yağ değişimi",
  quantity: 2,
  unitPriceKurus: 100_00,
  vatRate: "RATE_20",
};

function itemRow(overrides: Partial<WorkOrderItemRecord> = {}): WorkOrderItemRecord {
  return {
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
    ...overrides,
  };
}

describe("POST /work-orders/:id/items", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/items`,
      payload: addItemPayload,
    });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü kalem ekleyemez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/items`,
      headers: authHeader({ role: Role.DEALER }),
      payload: addItemPayload,
    });

    expect(response.statusCode).toBe(403);
  });

  it("geçersiz gövde (bilinmeyen vatRate) 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/items`,
      headers: authHeader(),
      payload: { ...addItemPayload, vatRate: "RATE_5" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("iş emri bulunamazsa 404 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/items`,
      headers: authHeader(),
      payload: addItemPayload,
    });

    expect(response.statusCode).toBe(404);
  });

  it("iş emri DELIVERED ise 409 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DELIVERED"));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/items`,
      headers: authHeader(),
      payload: addItemPayload,
    });

    expect(response.statusCode).toBe(409);
  });

  it("geçerli girdide 201 döner, tutarlar hesaplanmış olarak kaydedilir", async () => {
    const { scopedDb, findUnique, itemCreate } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    itemCreate.mockResolvedValue(itemRow());
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${workOrderId}/items`,
      headers: authHeader(),
      payload: addItemPayload,
    });

    expect(response.statusCode).toBe(201);
    expect(itemCreate).toHaveBeenCalledWith({
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
  });
});

describe("GET /work-orders/:id/items", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: `/work-orders/${workOrderId}/items` });

    expect(response.statusCode).toBe(401);
  });

  it("kalemleri 200 ile döner", async () => {
    const { scopedDb, itemFindMany } = createMockScopedDb();
    itemFindMany.mockResolvedValue([itemRow()]);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${workOrderId}/items`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    const body: { items: unknown[] } = response.json();
    expect(body.items).toHaveLength(1);
    expect(itemFindMany).toHaveBeenCalledWith({
      where: { workOrderId },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("DELETE /work-orders/:id/items/:itemId", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "DELETE", url: `/work-orders/${workOrderId}/items/item-1` });

    expect(response.statusCode).toBe(401);
  });

  it("iş emri bulunamazsa 404 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "DELETE",
      url: `/work-orders/${workOrderId}/items/item-1`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(404);
  });

  it("iş emri DELIVERED ise 409 döner", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DELIVERED"));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "DELETE",
      url: `/work-orders/${workOrderId}/items/item-1`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(409);
  });

  it("kalem bulunamazsa 404 döner", async () => {
    const { scopedDb, findUnique, itemFindUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    itemFindUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "DELETE",
      url: `/work-orders/${workOrderId}/items/item-1`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(404);
  });

  it("geçerli kalemde 204 döner", async () => {
    const { scopedDb, findUnique, itemFindUnique, itemDelete } = createMockScopedDb();
    findUnique.mockResolvedValue(workOrderRow("DRAFT"));
    itemFindUnique.mockResolvedValue(itemRow());
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "DELETE",
      url: `/work-orders/${workOrderId}/items/item-1`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(204);
    expect(itemDelete).toHaveBeenCalledWith({ where: { id: "item-1" } });
  });
});
