import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerFileRequestRoutes } from "./fileRequest.routes.js";
import { signAccessToken } from "../auth/authToken.js";
import { Role, EcuFileType } from "../../generated/prisma/enums.js";
import type { AppScopedDb } from "../../db/tenantScopedDb.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

const jwtSecret = "test-secret";
const hubTenantId = "hub-1";
const dealerTenantId = "dealer-1";
const vehicleId = "vehicle-1";
const readFileId = "read-file-1";
const fileRequestId = "req-1";
const dealerAccountId = "acct-1";

function createMockScopedDb() {
  const vehicleFindUnique = vi.fn<AppScopedDb["vehicle"]["findUnique"]>();
  vehicleFindUnique.mockResolvedValue({ id: vehicleId });
  const scopedDb = { vehicle: { findUnique: vehicleFindUnique } } as unknown as AppScopedDb;
  return { scopedDb, vehicleFindUnique };
}

function createFakeTx(overrides: { dealerAccountRow?: { id: string; creditBalanceKurus: number } } = {}) {
  const queryRaw = vi
    .fn()
    .mockResolvedValue([overrides.dealerAccountRow ?? { id: dealerAccountId, creditBalanceKurus: 20000 }]);
  const fileRequestFindUnique = vi.fn().mockResolvedValue({
    id: fileRequestId,
    hubTenantId,
    dealerTenantId,
    dealerAccountId,
    vehicleId,
    readFileId,
    requestedStage: EcuFileType.STAGE1,
    status: "IN_PROGRESS",
    costKurus: 5000,
  });
  const fileRequestUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const dealerAccountUpdate = vi.fn().mockResolvedValue({});
  const dealerCreditTransactionCreate = vi.fn().mockResolvedValue({});
  const auditCreate = vi.fn().mockResolvedValue({});
  const vehicleFindUnique = vi.fn().mockResolvedValue({ id: vehicleId });
  const ecuFileFindUnique = vi.fn().mockResolvedValue({
    id: readFileId,
    vehicleId,
    fileType: EcuFileType.ORIGINAL_STOCK,
  });
  const ecuFileCreate = vi.fn().mockResolvedValue({ id: "result-file-1" });

  const tx = {
    $queryRaw: queryRaw,
    fileRequest: { findUnique: fileRequestFindUnique, updateMany: fileRequestUpdateMany },
    dealerAccount: { update: dealerAccountUpdate },
    dealerCreditTransaction: { create: dealerCreditTransactionCreate },
    fileRequestStatusAuditLog: { create: auditCreate },
    vehicle: { findUnique: vehicleFindUnique },
    ecuFile: { create: ecuFileCreate, findUnique: ecuFileFindUnique },
  };
  return { tx, fileRequestFindUnique, fileRequestUpdateMany };
}

function createFakePrisma(
  scopedDb: AppScopedDb,
  tx: unknown = {},
  topLevel: {
    dealerAccountFindFirst?: ReturnType<typeof vi.fn>;
    fileRequestCreate?: ReturnType<typeof vi.fn>;
    fileRequestFindUnique?: ReturnType<typeof vi.fn>;
    fileRequestUpdate?: ReturnType<typeof vi.fn>;
    fileRequestFindMany?: ReturnType<typeof vi.fn>;
    auditCreate?: ReturnType<typeof vi.fn>;
    // bkz. fileRequest.routes.ts buildFileRequestDb — araç HER ZAMAN hub'ın
    // tenant'ına ait olduğu için artık ham `prisma.vehicle.findUnique`
    // üzerinden (hubTenantId'ye elle scoped) okunuyor, `scopedDb.vehicle`
    // ÜZERİNDEN DEĞİL (canlı Postgres'e karşı ilk e2e çalıştırmasında
    // dealer'ın kendi tenant'ına scoped eski versiyonun özelliği işlevsiz
    // kıldığı tespit edildi).
    vehicleFindUnique?: ReturnType<typeof vi.fn>;
  } = {},
): PrismaClient {
  const $transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(tx));
  return {
    $extends: () => scopedDb,
    $transaction,
    vehicle: { findUnique: topLevel.vehicleFindUnique ?? vi.fn().mockResolvedValue({ id: vehicleId }) },
    dealerAccount: { findFirst: topLevel.dealerAccountFindFirst ?? vi.fn() },
    fileRequest: {
      create: topLevel.fileRequestCreate ?? vi.fn().mockResolvedValue({ id: fileRequestId }),
      findUnique: topLevel.fileRequestFindUnique ?? vi.fn(),
      update: topLevel.fileRequestUpdate ?? vi.fn(),
      findMany: topLevel.fileRequestFindMany ?? vi.fn().mockResolvedValue([]),
    },
    fileRequestStatusAuditLog: { create: topLevel.auditCreate ?? vi.fn() },
  } as unknown as PrismaClient;
}

function buildTestApp(
  scopedDb: AppScopedDb,
  tx: unknown = {},
  topLevel: Parameters<typeof createFakePrisma>[2] = {},
) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Geçersiz istek gövdesi", issues: error.issues });
    }
    return reply.send(error);
  });
  const prisma = createFakePrisma(scopedDb, tx, topLevel);
  registerFileRequestRoutes(app, prisma, jwtSecret);
  return app;
}

function authHeader(overrides: { tenantId?: string; role?: Role } = {}) {
  const token = signAccessToken(
    { userId: "user-1", tenantId: overrides.tenantId ?? dealerTenantId, role: overrides.role ?? Role.DEALER },
    jwtSecret,
  );
  return { authorization: `Bearer ${token}` };
}

describe("POST /dealer/file-requests", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/dealer/file-requests",
      payload: { hubTenantId, vehicleId, readFileId, requestedStage: "STAGE1" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER dışı bir rol talep açamaz — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/dealer/file-requests",
      headers: authHeader({ role: Role.OWNER }),
      payload: { hubTenantId, vehicleId, readFileId, requestedStage: "STAGE1" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("geçersiz gövde (alanlar eksik) 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/dealer/file-requests",
      headers: authHeader(),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("bu hub/dealer çifti için kredi hesabı yoksa 404 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const dealerAccountFindFirst = vi.fn().mockResolvedValue(null);
    const app = buildTestApp(scopedDb, {}, { dealerAccountFindFirst });

    const response = await app.inject({
      method: "POST",
      url: "/dealer/file-requests",
      headers: authHeader(),
      payload: { hubTenantId, vehicleId, readFileId, requestedStage: "STAGE1" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("geçerli istek 201 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const dealerAccountFindFirst = vi.fn().mockResolvedValue({
      id: dealerAccountId,
      hubTenantId,
      dealerTenantId,
      creditBalanceKurus: 10000,
    });
    const app = buildTestApp(scopedDb, {}, { dealerAccountFindFirst });

    const response = await app.inject({
      method: "POST",
      url: "/dealer/file-requests",
      headers: authHeader(),
      payload: { hubTenantId, vehicleId, readFileId, requestedStage: "STAGE1" },
    });

    expect(response.statusCode).toBe(201);
  });
});

describe("PATCH /dealer/file-requests/:id/accept", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/dealer/file-requests/${fileRequestId}/accept`,
      payload: { costKurus: 5000 },
    });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü talebi kabul edemez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/dealer/file-requests/${fileRequestId}/accept`,
      headers: authHeader({ role: Role.DEALER, tenantId: hubTenantId }),
      payload: { costKurus: 5000 },
    });

    expect(response.statusCode).toBe(403);
  });

  it("costKurus eksikse 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/dealer/file-requests/${fileRequestId}/accept`,
      headers: authHeader({ role: Role.OWNER, tenantId: hubTenantId }),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("geçersiz durum geçişinde 409 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const fileRequestFindUnique = vi
      .fn()
      .mockResolvedValue({ id: fileRequestId, hubTenantId, dealerTenantId, status: "REJECTED" });
    const app = buildTestApp(scopedDb, {}, { fileRequestFindUnique });

    const response = await app.inject({
      method: "PATCH",
      url: `/dealer/file-requests/${fileRequestId}/accept`,
      headers: authHeader({ role: Role.OWNER, tenantId: hubTenantId }),
      payload: { costKurus: 5000 },
    });

    expect(response.statusCode).toBe(409);
  });

  it("geçerli geçişte 200 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const fileRequestFindUnique = vi
      .fn()
      .mockResolvedValue({ id: fileRequestId, hubTenantId, dealerTenantId, status: "PENDING" });
    const fileRequestUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const app = buildTestApp(scopedDb, {}, { fileRequestFindUnique, fileRequestUpdate, auditCreate });

    const response = await app.inject({
      method: "PATCH",
      url: `/dealer/file-requests/${fileRequestId}/accept`,
      headers: authHeader({ role: Role.OWNER, tenantId: hubTenantId }),
      payload: { costKurus: 5000 },
    });

    expect(response.statusCode).toBe(200);
    expect(fileRequestUpdate).toHaveBeenCalled();
    expect(auditCreate).toHaveBeenCalled();
  });
});

describe("PATCH /dealer/file-requests/:id/reject ve /start", () => {
  it("reject: geçerli geçişte 200 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const fileRequestFindUnique = vi
      .fn()
      .mockResolvedValue({ id: fileRequestId, hubTenantId, dealerTenantId, status: "PENDING" });
    const app = buildTestApp(scopedDb, {}, { fileRequestFindUnique });

    const response = await app.inject({
      method: "PATCH",
      url: `/dealer/file-requests/${fileRequestId}/reject`,
      headers: authHeader({ role: Role.OWNER, tenantId: hubTenantId }),
    });

    expect(response.statusCode).toBe(200);
  });

  it("start: geçerli geçişte 200 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const fileRequestFindUnique = vi
      .fn()
      .mockResolvedValue({ id: fileRequestId, hubTenantId, dealerTenantId, status: "ACCEPTED" });
    const app = buildTestApp(scopedDb, {}, { fileRequestFindUnique });

    const response = await app.inject({
      method: "PATCH",
      url: `/dealer/file-requests/${fileRequestId}/start`,
      headers: authHeader({ role: Role.OWNER, tenantId: hubTenantId }),
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("POST /dealer/file-requests/:id/fulfill", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: `/dealer/file-requests/${fileRequestId}/fulfill`,
      payload: { storageKey: "s3://k", checksum: "hash" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü fulfill edemez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: `/dealer/file-requests/${fileRequestId}/fulfill`,
      headers: authHeader({ role: Role.DEALER, tenantId: hubTenantId }),
      payload: { storageKey: "s3://k", checksum: "hash" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("yetersiz bakiyede 409 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx({ dealerAccountRow: { id: dealerAccountId, creditBalanceKurus: 100 } });
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: `/dealer/file-requests/${fileRequestId}/fulfill`,
      headers: authHeader({ role: Role.OWNER, tenantId: hubTenantId }),
      payload: { storageKey: "s3://k", checksum: "hash" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("geçerli istek 200 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: `/dealer/file-requests/${fileRequestId}/fulfill`,
      headers: authHeader({ role: Role.OWNER, tenantId: hubTenantId }),
      payload: { storageKey: "s3://k", checksum: "hash" },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("GET /dealer/file-requests", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: "/dealer/file-requests" });

    expect(response.statusCode).toBe(401);
  });

  it("RECEPTIONIST rolü göremez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: "/dealer/file-requests",
      headers: authHeader({ role: Role.RECEPTIONIST }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("DEALER kendi taleplerini (dealerTenantId filtresiyle) görür", async () => {
    const { scopedDb } = createMockScopedDb();
    const fileRequestFindMany = vi.fn().mockResolvedValue([]);
    const app = buildTestApp(scopedDb, {}, { fileRequestFindMany });

    const response = await app.inject({
      method: "GET",
      url: "/dealer/file-requests",
      headers: authHeader({ role: Role.DEALER, tenantId: dealerTenantId }),
    });

    expect(response.statusCode).toBe(200);
    expect(fileRequestFindMany).toHaveBeenCalledWith({ where: { dealerTenantId } });
  });

  it("OWNER kendi merkezine gelen talepleri (hubTenantId filtresiyle) görür", async () => {
    const { scopedDb } = createMockScopedDb();
    const fileRequestFindMany = vi.fn().mockResolvedValue([]);
    const app = buildTestApp(scopedDb, {}, { fileRequestFindMany });

    const response = await app.inject({
      method: "GET",
      url: "/dealer/file-requests",
      headers: authHeader({ role: Role.OWNER, tenantId: hubTenantId }),
    });

    expect(response.statusCode).toBe(200);
    expect(fileRequestFindMany).toHaveBeenCalledWith({ where: { hubTenantId } });
  });
});

describe("GET /dealer/account", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: `/dealer/account?hubTenantId=${hubTenantId}` });

    expect(response.statusCode).toBe(401);
  });

  it("OWNER/ENGINEER rolü kendi bakiyesini sorgulayamaz — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/dealer/account?hubTenantId=${hubTenantId}`,
      headers: authHeader({ role: Role.OWNER, tenantId: hubTenantId }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("hubTenantId query eksikse 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: "/dealer/account",
      headers: authHeader({ role: Role.DEALER, tenantId: dealerTenantId }),
    });

    expect(response.statusCode).toBe(400);
  });

  it("hesap yoksa 404 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const dealerAccountFindFirst = vi.fn().mockResolvedValue(null);
    const app = buildTestApp(scopedDb, {}, { dealerAccountFindFirst });

    const response = await app.inject({
      method: "GET",
      url: `/dealer/account?hubTenantId=${hubTenantId}`,
      headers: authHeader({ role: Role.DEALER, tenantId: dealerTenantId }),
    });

    expect(response.statusCode).toBe(404);
  });

  it("hesap varsa bakiyeyi 200 ile döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const dealerAccountFindFirst = vi
      .fn()
      .mockResolvedValue({ id: dealerAccountId, creditBalanceKurus: 15000 });
    const app = buildTestApp(scopedDb, {}, { dealerAccountFindFirst });

    const response = await app.inject({
      method: "GET",
      url: `/dealer/account?hubTenantId=${hubTenantId}`,
      headers: authHeader({ role: Role.DEALER, tenantId: dealerTenantId }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ creditBalanceKurus: 15000 });
    expect(dealerAccountFindFirst).toHaveBeenCalledWith({ where: { hubTenantId, dealerTenantId } });
  });
});
