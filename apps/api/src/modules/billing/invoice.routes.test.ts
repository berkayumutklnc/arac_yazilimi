import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../app.js";
import type { AppScopedDb } from "../../db/tenantScopedDb.js";
import { signAccessToken } from "../../modules/auth/authToken.js";
import { Role } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { InvoiceRecord } from "./invoiceGeneration.service.js";

const jwtSecret = "test-secret";
const tenantId = "tenant-1";
const workOrderId = "wo-1";
const invoiceId = "inv-1";

function invoiceRow(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: invoiceId,
    workOrderId,
    status: "DRAFT",
    invoiceNumber: null,
    issuedAt: null,
    voidedAt: null,
    totalKurus: 120_00,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function createMockScopedDb() {
  const invoiceFindUnique = vi.fn<AppScopedDb["invoice"]["findUnique"]>();
  const invoiceUpdate = vi.fn<AppScopedDb["invoice"]["update"]>();
  const lineFindMany = vi.fn<AppScopedDb["invoiceLine"]["findMany"]>();
  lineFindMany.mockResolvedValue([]);
  const auditCreate = vi.fn<AppScopedDb["invoiceStatusAuditLog"]["create"]>();
  const paymentCreate = vi.fn<AppScopedDb["payment"]["create"]>();
  const scopedDb = {
    invoice: { findUnique: invoiceFindUnique, update: invoiceUpdate },
    invoiceLine: { findMany: lineFindMany },
    invoiceStatusAuditLog: { create: auditCreate },
    payment: { create: paymentCreate },
  } as unknown as AppScopedDb;
  return { scopedDb, invoiceFindUnique, invoiceUpdate, lineFindMany, auditCreate, paymentCreate };
}

// issueInvoiceTransactional prisma.$transaction'ı DOĞRUDAN kullanır (request.tenantDb
// yerine) — bkz. invoiceTransactional.ts. Bu yüzden fake prisma hem $extends
// (tenantDb için) hem $transaction (issue route'u için) sağlamalı; $transaction
// tx olarak AYNI scopedDb şeklini + $executeRaw/$queryRaw'ı taşıyan bir nesne alır.
function createFakePrisma(
  scopedDb: AppScopedDb,
  txOverrides: { executeRaw?: ReturnType<typeof vi.fn>; queryRaw?: ReturnType<typeof vi.fn> } = {},
): PrismaClient {
  const executeRaw = txOverrides.executeRaw ?? vi.fn().mockResolvedValue(1);
  const queryRaw = txOverrides.queryRaw ?? vi.fn().mockResolvedValue([{ lastNumber: 0 }]);
  const tx = { ...scopedDb, $executeRaw: executeRaw, $queryRaw: queryRaw };
  return {
    $extends: () => scopedDb,
    $transaction: (fn: (tx: unknown) => unknown) => fn(tx),
  } as unknown as PrismaClient;
}

const unusedStorage = {
  createPresignedUploadUrl: vi.fn(),
  readObjectSha256: vi.fn(),
  createPresignedDownloadUrl: vi.fn(),
};
const unusedDiagServiceClient = { parseDtcFile: vi.fn(), analyzeWotFile: vi.fn() };
const unusedEmailSender = { sendInvitationEmail: vi.fn() };

function buildTestApp(
  scopedDb: AppScopedDb,
  txOverrides: { executeRaw?: ReturnType<typeof vi.fn>; queryRaw?: ReturnType<typeof vi.fn> } = {},
) {
  const prisma = createFakePrisma(scopedDb, txOverrides);
  return buildApp(prisma, {
    jwtSecret,
    storage: unusedStorage,
    diagServiceClient: unusedDiagServiceClient,
    emailSender: unusedEmailSender,
    webAppBaseUrl: "https://app.example.test",
  });
}

function authHeader(overrides: { tenantId?: string; role?: Role } = {}) {
  const token = signAccessToken(
    { userId: "user-1", tenantId: overrides.tenantId ?? tenantId, role: overrides.role ?? Role.OWNER },
    jwtSecret,
  );
  return { authorization: `Bearer ${token}` };
}

describe("GET /work-orders/:id/invoice", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: `/work-orders/${workOrderId}/invoice` });

    expect(response.statusCode).toBe(401);
  });

  it("ENGINEER rolü göremez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${workOrderId}/invoice`,
      headers: authHeader({ role: Role.ENGINEER }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("fatura bulunamazsa 404 döner", async () => {
    const { scopedDb, invoiceFindUnique } = createMockScopedDb();
    invoiceFindUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${workOrderId}/invoice`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(404);
  });

  it("faturayı 200 ile döner", async () => {
    const { scopedDb, invoiceFindUnique } = createMockScopedDb();
    invoiceFindUnique.mockResolvedValue(invoiceRow());
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${workOrderId}/invoice`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(invoiceFindUnique).toHaveBeenCalledWith({ where: { workOrderId } });
  });
});

describe("POST /invoices/:id/issue", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "POST", url: `/invoices/${invoiceId}/issue` });

    expect(response.statusCode).toBe(401);
  });

  it("RECEPTIONIST rolü fatura kesebilir — 200 döner, invoiceNumber atanır", async () => {
    const { scopedDb, invoiceFindUnique, invoiceUpdate } = createMockScopedDb();
    invoiceFindUnique.mockResolvedValue(invoiceRow());
    const queryRaw = vi.fn().mockResolvedValue([{ lastNumber: 4 }]);
    const app = buildTestApp(scopedDb, { queryRaw });

    const response = await app.inject({
      method: "POST",
      url: `/invoices/${invoiceId}/issue`,
      headers: authHeader({ role: Role.RECEPTIONIST }),
    });

    expect(response.statusCode).toBe(200);
    const body: { invoiceNumber: string } = response.json();
    expect(body.invoiceNumber).toMatch(/^\d{4}-000005$/);
    expect(invoiceUpdate).toHaveBeenCalled();
  });

  it("ENGINEER rolü fatura kesemez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/invoices/${invoiceId}/issue`,
      headers: authHeader({ role: Role.ENGINEER }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("fatura bulunamazsa 404 döner", async () => {
    const { scopedDb, invoiceFindUnique } = createMockScopedDb();
    invoiceFindUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/invoices/${invoiceId}/issue`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(404);
  });

  it("fatura DRAFT değilse 409 döner", async () => {
    const { scopedDb, invoiceFindUnique } = createMockScopedDb();
    invoiceFindUnique.mockResolvedValue(invoiceRow({ status: "ISSUED", invoiceNumber: "2026-000001" }));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/invoices/${invoiceId}/issue`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(409);
  });
});

describe("POST /invoices/:id/pay", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "POST", url: `/invoices/${invoiceId}/pay` });

    expect(response.statusCode).toBe(401);
  });

  it("ISSUED faturada 200 döner, Payment oluşur", async () => {
    const { scopedDb, invoiceFindUnique, paymentCreate } = createMockScopedDb();
    invoiceFindUnique.mockResolvedValue(invoiceRow({ status: "ISSUED", invoiceNumber: "2026-000001", totalKurus: 500_00 }));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/invoices/${invoiceId}/pay`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(paymentCreate).toHaveBeenCalledWith({ data: { invoiceId, amountKurus: 500_00 } });
  });

  it("DRAFT faturada 409 döner", async () => {
    const { scopedDb, invoiceFindUnique } = createMockScopedDb();
    invoiceFindUnique.mockResolvedValue(invoiceRow({ status: "DRAFT" }));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/invoices/${invoiceId}/pay`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(409);
  });
});

describe("POST /invoices/:id/void", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "POST", url: `/invoices/${invoiceId}/void`, payload: { reason: "x" } });

    expect(response.statusCode).toBe(401);
  });

  it("reason olmadan 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/invoices/${invoiceId}/void`,
      headers: authHeader(),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("ISSUED faturada reason ile 200 döner", async () => {
    const { scopedDb, invoiceFindUnique, auditCreate } = createMockScopedDb();
    invoiceFindUnique.mockResolvedValue(invoiceRow({ status: "ISSUED", invoiceNumber: "2026-000001" }));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/invoices/${invoiceId}/void`,
      headers: authHeader(),
      payload: { reason: "Müşteri iptal etti" },
    });

    expect(response.statusCode).toBe(200);
    const auditArgs = auditCreate.mock.calls[0]?.[0];
    expect(auditArgs?.data.reason).toBe("Müşteri iptal etti");
  });

  it("DRAFT faturada 409 döner (yalnızca ISSUED->VOID geçerli)", async () => {
    const { scopedDb, invoiceFindUnique } = createMockScopedDb();
    invoiceFindUnique.mockResolvedValue(invoiceRow({ status: "DRAFT" }));
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/invoices/${invoiceId}/void`,
      headers: authHeader(),
      payload: { reason: "x" },
    });

    expect(response.statusCode).toBe(409);
  });
});
