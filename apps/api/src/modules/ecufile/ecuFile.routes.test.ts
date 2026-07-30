import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerEcuFileRoutes } from "./ecuFile.routes.js";
import { signAccessToken } from "../auth/authToken.js";
import { Role, EcuFileType } from "../../generated/prisma/enums.js";
import type { AppScopedDb } from "../../db/tenantScopedDb.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { EcuFileStoragePort } from "./ecuFileUpload.service.js";
import type { EcuFileDownloadStoragePort } from "./ecuFileDownload.service.js";

const jwtSecret = "test-secret";
const tenantId = "tenant-1";
const vehicleId = "vehicle-1";
const ecuFileId = "ecu-file-1";

function createMockScopedDb() {
  const ecuFileFindUnique = vi.fn<AppScopedDb["ecuFile"]["findUnique"]>();
  const ecuFileFindMany = vi.fn<AppScopedDb["ecuFile"]["findMany"]>();
  ecuFileFindMany.mockResolvedValue([]);
  const downloadAuditCreate = vi.fn<AppScopedDb["ecuFileDownloadAuditLog"]["create"]>();
  const accessDeniedCreate = vi.fn<AppScopedDb["accessDeniedAuditLog"]["create"]>();
  const scopedDb = {
    ecuFile: { findUnique: ecuFileFindUnique, findMany: ecuFileFindMany },
    ecuFileDownloadAuditLog: { create: downloadAuditCreate },
    accessDeniedAuditLog: { create: accessDeniedCreate },
  } as unknown as AppScopedDb;
  return { scopedDb, ecuFileFindUnique, ecuFileFindMany, downloadAuditCreate, accessDeniedCreate };
}

function createFakeTx(overrides: { duplicateExisting?: { id: string } | null } = {}) {
  const vehicleFindUnique = vi.fn().mockResolvedValue({ id: vehicleId });
  const ecuFileFindFirst = vi.fn().mockResolvedValue(overrides.duplicateExisting ?? null);
  const ecuFileFindUnique = vi.fn().mockResolvedValue({
    id: "stock-1",
    vehicleId,
    fileType: EcuFileType.ORIGINAL_STOCK,
  });
  const ecuFileCreate = vi.fn().mockResolvedValue({ id: "new-file-id" });
  const tx = {
    vehicle: { findUnique: vehicleFindUnique },
    ecuFile: { create: ecuFileCreate, findUnique: ecuFileFindUnique, findFirst: ecuFileFindFirst },
  };
  return { tx, vehicleFindUnique, ecuFileFindFirst, ecuFileFindUnique, ecuFileCreate };
}

function createFakePrisma(scopedDb: AppScopedDb, tx: unknown = {}): PrismaClient {
  const $transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(tx));
  return {
    $extends: () => scopedDb,
    $transaction,
    ecuFile: { findFirst: vi.fn() },
  } as unknown as PrismaClient;
}

function createFakeStorage(
  overrides: Partial<EcuFileStoragePort & EcuFileDownloadStoragePort> = {},
): EcuFileStoragePort & EcuFileDownloadStoragePort {
  return {
    createPresignedUploadUrl: vi.fn().mockResolvedValue({ uploadUrl: "https://s3.example/upload", key: "k" }),
    readObjectSha256: vi.fn().mockResolvedValue("verified-hash"),
    createPresignedDownloadUrl: vi.fn().mockResolvedValue({ downloadUrl: "https://s3.example/download" }),
    ...overrides,
  };
}

function buildTestApp(
  scopedDb: AppScopedDb,
  tx: unknown = {},
  storage: EcuFileStoragePort & EcuFileDownloadStoragePort = createFakeStorage(),
) {
  const app = Fastify({ logger: false });
  // app.ts'in gerçek setErrorHandler'ının aynısı — bu test doğrudan Fastify
  // örneği üzerinde route'ları kaydettiği için (buildApp üzerinden değil)
  // ZodError → 400 eşlemesi burada da tekrarlanmalı.
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Geçersiz istek gövdesi", issues: error.issues });
    }
    return reply.send(error);
  });
  const prisma = createFakePrisma(scopedDb, tx);
  registerEcuFileRoutes(app, prisma, jwtSecret, storage);
  return app;
}

function authHeader(overrides: { role?: Role } = {}) {
  const token = signAccessToken(
    { userId: "user-1", tenantId, role: overrides.role ?? Role.OWNER },
    jwtSecret,
  );
  return { authorization: `Bearer ${token}` };
}

describe("POST /vehicles/:vehicleId/ecu-files/upload-request", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-request`,
      payload: { fileName: "stage1.bin" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü upload isteyemez — 403 döner ve reddedilen deneme audit loglanır", async () => {
    const { scopedDb, accessDeniedCreate } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-request`,
      headers: authHeader({ role: Role.DEALER }),
      payload: { fileName: "stage1.bin" },
    });

    expect(response.statusCode).toBe(403);
    expect(accessDeniedCreate).toHaveBeenCalledWith({
      // expect.objectContaining() tipi vitest'te `any` döner (bilinen tip boşluğu).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        resource: "ECU_FILE_UPLOAD",
        reason: "FORBIDDEN_ROLE",
        resourceId: vehicleId,
      }),
    });
  });

  it("yasaklı dosya adı 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-request`,
      headers: authHeader(),
      payload: { fileName: "dpf_off_stage1.bin" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("geçersiz gövde (fileName eksik) 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-request`,
      headers: authHeader(),
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  it("geçerli istek 200 döner, presigned upload URL içerir", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-request`,
      headers: authHeader(),
      payload: { fileName: "stage1_remap.bin" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("uploadUrl");
  });
});

describe("POST /vehicles/:vehicleId/ecu-files/upload-confirm", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-confirm`,
      payload: { storageKey: "k", fileType: "STAGE1", claimedChecksum: "h", stockRomRef: "stock-1" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü upload-confirm çağıramaz — 403 döner ve audit loglanır", async () => {
    const { scopedDb, accessDeniedCreate } = createMockScopedDb();
    const { tx } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-confirm`,
      headers: authHeader({ role: Role.DEALER }),
      payload: { storageKey: "k", fileType: "STAGE1", claimedChecksum: "h", stockRomRef: "stock-1" },
    });

    expect(response.statusCode).toBe(403);
    expect(accessDeniedCreate).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({ resource: "ECU_FILE_UPLOAD", reason: "FORBIDDEN_ROLE" }),
    });
  });

  it("hash uyuşmazlığında 400 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx();
    const storage = createFakeStorage({
      readObjectSha256: vi.fn().mockResolvedValue("actual-hash"),
    });
    const app = buildTestApp(scopedDb, tx, storage);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-confirm`,
      headers: authHeader(),
      payload: { storageKey: "k", fileType: "STAGE1", claimedChecksum: "claimed-hash", stockRomRef: "stock-1" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("mükerrer dosyada 409 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx({ duplicateExisting: { id: "existing-file-id" } });
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-confirm`,
      headers: authHeader(),
      payload: { storageKey: "k", fileType: "STAGE1", claimedChecksum: "verified-hash", stockRomRef: "stock-1" },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ existingFileId: "existing-file-id" });
  });

  it("geçerli istek 201 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: `/vehicles/${vehicleId}/ecu-files/upload-confirm`,
      headers: authHeader(),
      payload: { storageKey: "k", fileType: "STAGE1", claimedChecksum: "verified-hash", stockRomRef: "stock-1" },
    });

    expect(response.statusCode).toBe(201);
  });
});

describe("GET /ecu-files/:id/download", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: `/ecu-files/${ecuFileId}/download` });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü indiremez — 403 döner ve audit loglanır", async () => {
    const { scopedDb, accessDeniedCreate } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/ecu-files/${ecuFileId}/download`,
      headers: authHeader({ role: Role.DEALER }),
    });

    expect(response.statusCode).toBe(403);
    expect(accessDeniedCreate).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        resource: "ECU_FILE_DOWNLOAD",
        reason: "FORBIDDEN_ROLE",
        resourceId: ecuFileId,
      }),
    });
  });

  it("dosya bulunamazsa 404 döner ve audit loglanır (reason=NOT_FOUND)", async () => {
    const { scopedDb, ecuFileFindUnique, accessDeniedCreate } = createMockScopedDb();
    ecuFileFindUnique.mockResolvedValue(null);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/ecu-files/${ecuFileId}/download`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(404);
    expect(accessDeniedCreate).toHaveBeenCalledWith({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({ resource: "ECU_FILE_DOWNLOAD", reason: "NOT_FOUND" }),
    });
  });

  it("başarılı indirmede 200 döner, indirme audit loglanır, reddedilen-erişim loglanmaz", async () => {
    const { scopedDb, ecuFileFindUnique, downloadAuditCreate, accessDeniedCreate } = createMockScopedDb();
    ecuFileFindUnique.mockResolvedValue({ id: ecuFileId, storageKey: "tenant-1/vehicle-1/stage1.bin" });
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/ecu-files/${ecuFileId}/download`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("downloadUrl");
    expect(downloadAuditCreate).toHaveBeenCalledTimes(1);
    expect(accessDeniedCreate).not.toHaveBeenCalled();
  });
});

describe("GET /vehicles/:vehicleId/ecu-files", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: `/vehicles/${vehicleId}/ecu-files` });

    expect(response.statusCode).toBe(401);
  });

  it("DEALER rolü göremez — 403 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/vehicles/${vehicleId}/ecu-files`,
      headers: authHeader({ role: Role.DEALER }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("aracın stock/stage dosyalarını 200 ile döner", async () => {
    const { scopedDb, ecuFileFindMany } = createMockScopedDb();
    const stockId = "stock-1";
    ecuFileFindMany.mockResolvedValue([
      {
        id: stockId,
        fileType: EcuFileType.ORIGINAL_STOCK,
        stockRomRef: stockId,
        checksum: "stock-hash",
        uploadedBy: "user-1",
        createdAt: new Date("2026-01-01"),
      },
    ]);
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/vehicles/${vehicleId}/ecu-files`,
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    const body: { items: unknown[] } = response.json();
    expect(body.items).toHaveLength(1);
    expect(ecuFileFindMany).toHaveBeenCalledWith({ where: { vehicleId } });
  });
});
