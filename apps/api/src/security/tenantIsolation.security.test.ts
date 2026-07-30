/**
 * Kötü niyetli komşu tenant + kimlik doğrulama testleri (bkz. docs/security-audit.md).
 *
 * Bölüm 1-2: servis katmanı — Tenant A'nın verisi vardır, Tenant B kendi
 * (scoped) db'siyle A'nın kaydına erişmeye/değiştirmeye çalışır.
 * Bölüm 3: route/JWT katmanı — sahte/expired/başka tenant'ın token'ı ile
 * gerçek `app.inject()` üzerinden authPreHandler'ın gerçekten çalıştığı
 * kanıtlanır (bkz. docs/security-audit.md KRİTİK-0 — artık kapatıldı).
 */
import { describe, expect, it, vi } from "vitest";
import { createSigner } from "fast-jwt";
import { Role } from "../generated/prisma/enums.js";

import {
  transitionWorkOrderStatus,
  WorkOrderNotFoundError,
  type WorkOrderTransitionDb,
} from "../modules/workorder/workOrderTransition.service.js";
import {
  applyServiceTypeToWorkOrder,
  type WorkOrderComplianceDb,
} from "../modules/workorder/workOrderCompliance.service.js";
import {
  downloadEcuFile,
  EcuFileNotFoundError,
  type EcuFileDownloadDb,
  type EcuFileDownloadStoragePort,
} from "../modules/ecufile/ecuFileDownload.service.js";
import { createEcuFile, type EcuFileDb } from "../modules/ecufile/ecuFile.service.js";
import {
  createFileRequest,
  transitionFileRequestStatus,
  ForbiddenRoleError as FileRequestForbiddenRoleError,
  type FileRequestDb,
} from "../modules/dealer/fileRequest.service.js";
import {
  fulfillFileRequest,
  type FulfillFileRequestDb,
} from "../modules/dealer/fileRequestFulfillment.service.js";
import { buildApp } from "../app.js";
import type { AppScopedDb } from "../db/tenantScopedDb.js";
import { signAccessToken } from "../modules/auth/authToken.js";
import { refreshTokens, InvalidRefreshTokenError, type AuthRefreshDb } from "../modules/auth/authRefresh.service.js";
import type { PrismaClient } from "../generated/prisma/client.js";

const TENANT_B = "tenant-B-attacker";

describe("Kötü niyetli komşu tenant — mevcut korumalar", () => {
  it("WorkOrder: Tenant B'nin scoped db'si, Tenant A'nın iş emrini bulamaz (tenantId artık elle geçilmiyor)", async () => {
    const findUnique = vi.fn<WorkOrderTransitionDb["workOrder"]["findUnique"]>();
    findUnique.mockResolvedValue(null); // B'nin tenant-scoped db'si A'nın kaydını asla döndürmez
    const update = vi.fn<WorkOrderTransitionDb["workOrder"]["update"]>();
    const auditCreate = vi.fn<WorkOrderTransitionDb["workOrderStatusAuditLog"]["create"]>();
    const db: WorkOrderTransitionDb = {
      workOrder: { findUnique, update },
      workOrderStatusAuditLog: { create: auditCreate },
    };

    await expect(
      transitionWorkOrderStatus(db, {
        workOrderId: "wo-belongs-to-A",
        toStatus: "ACCEPTED",
        changedBy: "attacker-user",
      }),
    ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "wo-belongs-to-A" } });
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("EcuFile indirme: Tenant B'nin scoped db'si, Tenant A'nın ECU dosyasını bulamaz", async () => {
    const findUnique = vi.fn<EcuFileDownloadDb["ecuFile"]["findUnique"]>();
    findUnique.mockResolvedValue(null);
    const auditCreate = vi.fn<EcuFileDownloadDb["ecuFileDownloadAuditLog"]["create"]>();
    const createPresignedDownloadUrl =
      vi.fn<EcuFileDownloadStoragePort["createPresignedDownloadUrl"]>();
    const db: EcuFileDownloadDb = {
      ecuFile: { findUnique },
      ecuFileDownloadAuditLog: { create: auditCreate },
    };

    await expect(
      downloadEcuFile(
        { db, storage: { createPresignedDownloadUrl } },
        { ecuFileId: "file-belongs-to-A", requestedBy: { id: "attacker-user", role: Role.OWNER } },
      ),
    ).rejects.toBeInstanceOf(EcuFileNotFoundError);
    expect(createPresignedDownloadUrl).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("FileRequest işleme: Tenant C'nin OWNER'ı, Tenant A→Tenant hub B talebini işleyemez", async () => {
    const findUnique = vi.fn<FileRequestDb["fileRequest"]["findUnique"]>();
    const update = vi.fn<FileRequestDb["fileRequest"]["update"]>();
    const auditCreate = vi.fn<FileRequestDb["fileRequestStatusAuditLog"]["create"]>();
    const dealerAccountFindFirst = vi.fn<FileRequestDb["dealerAccount"]["findFirst"]>();
    const db: FileRequestDb = {
      vehicle: { findUnique: vi.fn() },
      dealerAccount: { findFirst: dealerAccountFindFirst },
      fileRequest: { create: vi.fn(), findUnique, update },
      fileRequestStatusAuditLog: { create: auditCreate },
    };
    const intruderFromTenantC = { id: "intruder", tenantId: "tenant-C", role: Role.OWNER };

    await expect(
      transitionFileRequestStatus(db, {
        fileRequestId: "req-hub-B",
        hubTenantId: TENANT_B,
        toStatus: "ACCEPTED",
        actingUser: intruderFromTenantC,
        costKurus: 1000,
      }),
    ).rejects.toBeInstanceOf(FileRequestForbiddenRoleError);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("FileRequest fulfill: yanlış hub tenant'ının OWNER'ı kalibre dosya yükleyip kredi düşüremez", async () => {
    const fileRequestFindUnique = vi.fn<FulfillFileRequestDb["fileRequest"]["findUnique"]>();
    const fileRequestUpdate = vi.fn<FulfillFileRequestDb["fileRequest"]["update"]>();
    const dealerAccountFindUnique = vi.fn<FulfillFileRequestDb["dealerAccount"]["findUnique"]>();
    const dealerAccountUpdate = vi.fn<FulfillFileRequestDb["dealerAccount"]["update"]>();
    const dealerCreditTransactionCreate =
      vi.fn<FulfillFileRequestDb["dealerCreditTransaction"]["create"]>();
    const auditCreate = vi.fn<FulfillFileRequestDb["fileRequestStatusAuditLog"]["create"]>();
    const db: FulfillFileRequestDb = {
      fileRequest: { findUnique: fileRequestFindUnique, update: fileRequestUpdate },
      dealerAccount: { findUnique: dealerAccountFindUnique, update: dealerAccountUpdate },
      dealerCreditTransaction: { create: dealerCreditTransactionCreate },
      fileRequestStatusAuditLog: { create: auditCreate },
    };
    const scopeEcuFileToDealerTenant = vi.fn();
    const intruderOwner = { id: "intruder-owner", tenantId: "tenant-not-the-hub", role: Role.OWNER };

    await expect(
      fulfillFileRequest(
        { db, scopeEcuFileToDealerTenant },
        {
          fileRequestId: "req-1",
          hubTenantId: TENANT_B,
          actingUser: intruderOwner,
          storageKey: "s3://stolen/file.bin",
          checksum: "irrelevant",
        },
      ),
    ).rejects.toThrow();
    expect(fileRequestFindUnique).not.toHaveBeenCalled();
    expect(scopeEcuFileToDealerTenant).not.toHaveBeenCalled();
    expect(dealerAccountUpdate).not.toHaveBeenCalled();
    expect(dealerCreditTransactionCreate).not.toHaveBeenCalled();
  });
});

describe("Kötü niyetli komşu tenant — yamalanan zafiyetler", () => {
  it("EcuFile oluşturma: Tenant B'nin scoped db'si Tenant A'nın aracını bulamaz, dosya kaydı iliştirilemez", async () => {
    const create = vi.fn<EcuFileDb["ecuFile"]["create"]>();
    const findUnique = vi.fn<EcuFileDb["ecuFile"]["findUnique"]>();
    const vehicleFindUnique = vi.fn<EcuFileDb["vehicle"]["findUnique"]>();
    vehicleFindUnique.mockResolvedValue(null); // B'nin scoped db'sinde A'nın aracı yok
    const db: EcuFileDb = { vehicle: { findUnique: vehicleFindUnique }, ecuFile: { create, findUnique } };

    await expect(
      createEcuFile(db, {
        vehicleId: "vehicle-belongs-to-A",
        fileType: "ORIGINAL_STOCK",
        storageKey: "s3://attacker/upload.bin",
        checksum: "attacker-checksum",
        uploadedBy: "attacker-user",
      }),
    ).rejects.toThrow();
    expect(vehicleFindUnique).toHaveBeenCalledWith({ where: { id: "vehicle-belongs-to-A" } });
    expect(create).not.toHaveBeenCalled();
  });

  it("FileRequest oluşturma: kötü niyetli bir DEALER'ın scoped db'si Tenant A'nın aracını bulamaz", async () => {
    const dealerAccountFindFirst = vi.fn<FileRequestDb["dealerAccount"]["findFirst"]>();
    dealerAccountFindFirst.mockResolvedValue({
      id: "acct-1",
      hubTenantId: "hub-1",
      dealerTenantId: TENANT_B,
      creditBalanceKurus: 100000,
    });
    const fileRequestCreate = vi.fn<FileRequestDb["fileRequest"]["create"]>();
    const vehicleFindUnique = vi.fn<FileRequestDb["vehicle"]["findUnique"]>();
    vehicleFindUnique.mockResolvedValue(null);
    const db: FileRequestDb = {
      vehicle: { findUnique: vehicleFindUnique },
      dealerAccount: { findFirst: dealerAccountFindFirst },
      fileRequest: { create: fileRequestCreate, findUnique: vi.fn(), update: vi.fn() },
      fileRequestStatusAuditLog: { create: vi.fn() },
    };
    const maliciousDealer = { id: "malicious-dealer", tenantId: TENANT_B, role: Role.DEALER };

    await expect(
      createFileRequest(db, maliciousDealer, {
        hubTenantId: "hub-1",
        vehicleId: "vehicle-belongs-to-A",
        readFileId: "some-file-id",
        requestedStage: "STAGE1",
      }),
    ).rejects.toThrow();
    expect(vehicleFindUnique).toHaveBeenCalledWith({ where: { id: "vehicle-belongs-to-A" } });
    expect(fileRequestCreate).not.toHaveBeenCalled();
  });

  it("WorkOrderCompliance: Tenant B'nin scoped db'si Tenant A'nın iş emrini bulamaz, AİTM alanları değiştirilemez", async () => {
    const workOrderFindUnique = vi.fn<WorkOrderComplianceDb["workOrder"]["findUnique"]>();
    workOrderFindUnique.mockResolvedValue(null);
    const workOrderUpdate = vi.fn<WorkOrderComplianceDb["workOrder"]["update"]>();
    const stepFindMany = vi.fn<WorkOrderComplianceDb["workOrderComplianceStep"]["findMany"]>();
    const stepCreateMany = vi.fn<WorkOrderComplianceDb["workOrderComplianceStep"]["createMany"]>();
    const db: WorkOrderComplianceDb = {
      workOrder: { findUnique: workOrderFindUnique, update: workOrderUpdate },
      workOrderComplianceStep: { findMany: stepFindMany, createMany: stepCreateMany },
    };

    await expect(
      applyServiceTypeToWorkOrder(
        db,
        { workOrderId: "wo-belongs-to-A" },
        { id: "svc-1", affectsEnginePower: true },
      ),
    ).rejects.toThrow();
    expect(workOrderFindUnique).toHaveBeenCalledWith({ where: { id: "wo-belongs-to-A" } });
    expect(workOrderUpdate).not.toHaveBeenCalled();
    expect(stepCreateMany).not.toHaveBeenCalled();
  });
});

describe("Kimlik doğrulama — sahte/geçersiz/başka tenant'ın token'ı (KRİTİK-0)", () => {
  const jwtSecret = "route-test-secret";
  const tenantAWorkOrderId = "wo-a-1";

  function createMockScopedDb() {
    const findUnique = vi.fn<AppScopedDb["workOrder"]["findUnique"]>();
    const update = vi.fn<AppScopedDb["workOrder"]["update"]>();
    const auditCreate = vi.fn<AppScopedDb["workOrderStatusAuditLog"]["create"]>();
    const scopedDb = {
      workOrder: { findUnique, update },
      workOrderStatusAuditLog: { create: auditCreate },
    } as unknown as AppScopedDb;
    return { scopedDb, findUnique, update, auditCreate };
  }

  // Bu senaryolar storage/diagServiceClient kullanmıyor — buildApp'in imzası
  // gerektirdiği için (bkz. ecuFile.routes.ts) yalnızca mekanik fake'ler geçiriliyor.
  const unusedStorage = {
    createPresignedUploadUrl: vi.fn(),
    readObjectSha256: vi.fn(),
    createPresignedDownloadUrl: vi.fn(),
  };
  const unusedDiagServiceClient = { parseDtcFile: vi.fn(), analyzeWotFile: vi.fn() };

  function buildTestApp(scopedDb: AppScopedDb) {
    const prisma = { $extends: () => scopedDb } as unknown as PrismaClient;
    return buildApp(prisma, { jwtSecret, storage: unusedStorage, diagServiceClient: unusedDiagServiceClient });
  }

  it("token hiç yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${tenantAWorkOrderId}/status`,
      payload: { toStatus: "ACCEPTED" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("sahte/rastgele bir token ile 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${tenantAWorkOrderId}/status`,
      headers: { authorization: "Bearer completely.fake.token" },
      payload: { toStatus: "ACCEPTED" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("başka bir sırla imzalanmış (sahte) token ile 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);
    const forgedToken = signAccessToken(
      { userId: "attacker", tenantId: "tenant-A", role: Role.OWNER },
      "attacker-controlled-secret",
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${tenantAWorkOrderId}/status`,
      headers: { authorization: `Bearer ${forgedToken}` },
      payload: { toStatus: "ACCEPTED" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("süresi dolmuş bir token ile 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);
    const expiredSigner = createSigner({ key: jwtSecret, expiresIn: -1000 });
    const expiredToken = expiredSigner({ userId: "user-1", tenantId: "tenant-A", role: Role.OWNER });

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${tenantAWorkOrderId}/status`,
      headers: { authorization: `Bearer ${expiredToken}` },
      payload: { toStatus: "ACCEPTED" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("GEÇERLİ ama başka bir tenant'ın (Tenant B) token'ıyla Tenant A'nın iş emrine erişilemez — 401 değil 404 (izolasyon çalışıyor)", async () => {
    const { scopedDb, findUnique } = createMockScopedDb();
    findUnique.mockResolvedValue(null); // Tenant B'ye scoped db, A'nın kaydını hiç göremiyor
    const app = buildTestApp(scopedDb);
    const validTokenForTenantB = signAccessToken(
      { userId: "user-b", tenantId: TENANT_B, role: Role.OWNER },
      jwtSecret,
    );

    const response = await app.inject({
      method: "PATCH",
      url: `/work-orders/${tenantAWorkOrderId}/status`,
      headers: { authorization: `Bearer ${validTokenForTenantB}` },
      payload: { toStatus: "ACCEPTED" },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("Kimlik doğrulama — çalınmış (reuse edilen) refresh token", () => {
  it("iptal edilmiş bir refresh token tekrar sunulursa kullanıcının TÜM token'ları iptal edilir ve 401 eşdeğeri hata döner", async () => {
    const findUnique = vi.fn<AuthRefreshDb["refreshToken"]["findUnique"]>();
    findUnique.mockResolvedValue({
      id: "rt-1",
      userId: "victim-user",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: new Date(Date.now() - 1000), // daha önce rotasyonla iptal edilmiş — şimdi tekrar sunuluyor
    });
    const updateMany = vi.fn<AuthRefreshDb["refreshToken"]["updateMany"]>();
    const db: AuthRefreshDb = {
      refreshToken: {
        findUnique,
        update: vi.fn(),
        create: vi.fn(),
        updateMany,
      },
      user: { findUnique: vi.fn() },
    };

    await expect(refreshTokens(db, "secret", "stolen-token")).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "victim-user", revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });
});
