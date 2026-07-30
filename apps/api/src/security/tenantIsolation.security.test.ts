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
import { signAccessToken, verifyAccessToken } from "../modules/auth/authToken.js";
import { refreshTokens, InvalidRefreshTokenError, type AuthRefreshDb } from "../modules/auth/authRefresh.service.js";
import {
  respondToDealerLink,
  DealerLinkNotFoundError,
  type DealerLinkDb,
} from "../modules/dealer/dealerLink.service.js";
import { topUpDealerCredit, type DealerCreditTopupDb } from "../modules/dealer/dealerCreditTopup.service.js";
import {
  redeemInvitation,
  InvalidInvitationTokenError,
  type InvitationRedemptionDb,
} from "../modules/invitation/invitationRedemption.service.js";
import {
  changeUserRole,
  deactivateUser,
  UserNotFoundError,
  type UserManagementDb,
} from "../modules/user/userManagement.service.js";
import {
  addWorkOrderItem,
  removeWorkOrderItem,
  type WorkOrderItemDb,
} from "../modules/workorder/workOrderItem.service.js";
import {
  issueInvoice,
  markInvoicePaid,
  voidInvoice,
  InvoiceNotFoundError,
  type InvoiceDb,
} from "../modules/billing/invoice.service.js";
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

  it("WorkOrderItem: Tenant B'nin scoped db'si, Tenant A'nın iş emrine kalem ekleyemez/silemez (bkz. ADR 0014)", async () => {
    const workOrderFindUnique = vi.fn<WorkOrderItemDb["workOrder"]["findUnique"]>();
    workOrderFindUnique.mockResolvedValue(null); // B'nin tenant-scoped db'si A'nın iş emrini asla döndürmez
    const itemCreate = vi.fn<WorkOrderItemDb["workOrderItem"]["create"]>();
    const itemFindUnique = vi.fn<WorkOrderItemDb["workOrderItem"]["findUnique"]>();
    const itemDelete = vi.fn<WorkOrderItemDb["workOrderItem"]["delete"]>();
    const db: WorkOrderItemDb = {
      workOrder: { findUnique: workOrderFindUnique },
      workOrderItem: { create: itemCreate, findMany: vi.fn(), findUnique: itemFindUnique, delete: itemDelete },
    };

    await expect(
      addWorkOrderItem(db, {
        workOrderId: "wo-belongs-to-A",
        itemType: "SERVICE",
        description: "x",
        quantity: 1,
        unitPriceKurus: 100,
        vatRate: "RATE_0",
      }),
    ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    expect(itemCreate).not.toHaveBeenCalled();

    await expect(removeWorkOrderItem(db, "wo-belongs-to-A", "item-1")).rejects.toBeInstanceOf(
      WorkOrderNotFoundError,
    );
    expect(itemDelete).not.toHaveBeenCalled();
  });

  it("Invoice: Tenant B'nin scoped db'si, Tenant A'nın faturasını issue/pay/void edemez (bkz. ADR 0014)", async () => {
    const findUnique = vi.fn<InvoiceDb["invoice"]["findUnique"]>();
    findUnique.mockResolvedValue(null); // B'nin tenant-scoped db'si A'nın faturasını asla döndürmez
    const update = vi.fn<InvoiceDb["invoice"]["update"]>();
    const auditCreate = vi.fn<InvoiceDb["invoiceStatusAuditLog"]["create"]>();
    const paymentCreate = vi.fn<InvoiceDb["payment"]["create"]>();
    const db: InvoiceDb = {
      invoice: { findUnique, update },
      invoiceLine: { findMany: vi.fn() },
      invoiceStatusAuditLog: { create: auditCreate },
      payment: { create: paymentCreate },
    };

    await expect(
      issueInvoice(db, { invoiceId: "inv-belongs-to-A", invoiceNumber: "2026-000001", actorId: "attacker" }),
    ).rejects.toBeInstanceOf(InvoiceNotFoundError);
    await expect(
      markInvoicePaid(db, { invoiceId: "inv-belongs-to-A", actorId: "attacker" }),
    ).rejects.toBeInstanceOf(InvoiceNotFoundError);
    await expect(
      voidInvoice(db, { invoiceId: "inv-belongs-to-A", actorId: "attacker", reason: "x" }),
    ).rejects.toBeInstanceOf(InvoiceNotFoundError);
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
    expect(paymentCreate).not.toHaveBeenCalled();
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
  const unusedEmailSender = { sendInvitationEmail: vi.fn() };

  function buildTestApp(scopedDb: AppScopedDb) {
    const prisma = { $extends: () => scopedDb } as unknown as PrismaClient;
    return buildApp(prisma, {
      jwtSecret,
      storage: unusedStorage,
      diagServiceClient: unusedDiagServiceClient,
      emailSender: unusedEmailSender,
      webAppBaseUrl: "https://app.example.test",
    });
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

describe("Kötü niyetli komşu tenant — WorkOrderItem/Invoice route'ları (ADR 0014)", () => {
  const jwtSecret = "route-test-secret-billing";
  const tenantAWorkOrderId = "wo-a-1";
  const tenantAInvoiceId = "inv-a-1";

  const unusedStorage = {
    createPresignedUploadUrl: vi.fn(),
    readObjectSha256: vi.fn(),
    createPresignedDownloadUrl: vi.fn(),
  };
  const unusedDiagServiceClient = { parseDtcFile: vi.fn(), analyzeWotFile: vi.fn() };
  const unusedEmailSender = { sendInvitationEmail: vi.fn() };

  function buildTestApp(scopedDb: AppScopedDb) {
    const prisma = {
      $extends: () => scopedDb,
      $transaction: (fn: (tx: unknown) => unknown) => fn(scopedDb),
    } as unknown as PrismaClient;
    return buildApp(prisma, {
      jwtSecret,
      storage: unusedStorage,
      diagServiceClient: unusedDiagServiceClient,
      emailSender: unusedEmailSender,
      webAppBaseUrl: "https://app.example.test",
    });
  }

  function tokenForTenantB() {
    return signAccessToken({ userId: "user-b", tenantId: TENANT_B, role: Role.OWNER }, jwtSecret);
  }

  it("GEÇERLİ ama başka bir tenant'ın (Tenant B) token'ıyla Tenant A'nın iş emrine kalem eklenemez — 404", async () => {
    const workOrderFindUnique = vi.fn<AppScopedDb["workOrder"]["findUnique"]>();
    workOrderFindUnique.mockResolvedValue(null);
    const scopedDb = {
      workOrder: { findUnique: workOrderFindUnique },
      workOrderItem: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    } as unknown as AppScopedDb;
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: `/work-orders/${tenantAWorkOrderId}/items`,
      headers: { authorization: `Bearer ${tokenForTenantB()}` },
      payload: { itemType: "SERVICE", description: "x", quantity: 1, unitPriceKurus: 100, vatRate: "RATE_0" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("GEÇERLİ ama başka bir tenant'ın (Tenant B) token'ıyla Tenant A'nın iş emrinden kalem silinemez — 404", async () => {
    const workOrderFindUnique = vi.fn<AppScopedDb["workOrder"]["findUnique"]>();
    workOrderFindUnique.mockResolvedValue(null);
    const scopedDb = {
      workOrder: { findUnique: workOrderFindUnique },
      workOrderItem: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
    } as unknown as AppScopedDb;
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "DELETE",
      url: `/work-orders/${tenantAWorkOrderId}/items/item-1`,
      headers: { authorization: `Bearer ${tokenForTenantB()}` },
    });

    expect(response.statusCode).toBe(404);
  });

  it.each([
    ["POST", "issue"],
    ["POST", "pay"],
    ["POST", "void"],
  ] as const)(
    "GEÇERLİ ama başka bir tenant'ın (Tenant B) token'ıyla Tenant A'nın faturası %s /invoices/:id/%s edilemez — 404",
    async (method, action) => {
      const invoiceFindUnique = vi.fn<AppScopedDb["invoice"]["findUnique"]>();
      invoiceFindUnique.mockResolvedValue(null);
      const scopedDb = {
        invoice: { findUnique: invoiceFindUnique, update: vi.fn() },
        invoiceLine: { findMany: vi.fn() },
        invoiceStatusAuditLog: { create: vi.fn() },
        payment: { create: vi.fn() },
        // issue route'u issueInvoiceTransactional üzerinden prisma.$transaction
        // kullanır (bkz. invoiceTransactional.ts) — o yolun tx'i $executeRaw/
        // $queryRaw'ı da (sayaç ayırma) çağırır, fatura bulunamadan önce.
        $executeRaw: vi.fn().mockResolvedValue(1),
        $queryRaw: vi.fn().mockResolvedValue([{ lastNumber: 0 }]),
      } as unknown as AppScopedDb;
      const app = buildTestApp(scopedDb);

      const response = await app.inject({
        method,
        url: `/invoices/${tenantAInvoiceId}/${action}`,
        headers: { authorization: `Bearer ${tokenForTenantB()}` },
        payload: action === "void" ? { reason: "x" } : undefined,
      });

      expect(response.statusCode).toBe(404);
    },
  );

  it("GEÇERLİ ama başka bir tenant'ın (Tenant B) token'ıyla Tenant A'nın faturası görüntülenemez — 404", async () => {
    const invoiceFindUnique = vi.fn<AppScopedDb["invoice"]["findUnique"]>();
    invoiceFindUnique.mockResolvedValue(null);
    const scopedDb = {
      invoice: { findUnique: invoiceFindUnique, update: vi.fn() },
      invoiceLine: { findMany: vi.fn() },
      invoiceStatusAuditLog: { create: vi.fn() },
      payment: { create: vi.fn() },
    } as unknown as AppScopedDb;
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "GET",
      url: `/work-orders/${tenantAWorkOrderId}/invoice`,
      headers: { authorization: `Bearer ${tokenForTenantB()}` },
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

describe("Platform-admin (SUPER_ADMIN) izolasyonu (ADR 0010)", () => {
  const jwtSecret = "admin-security-test-secret";
  const unusedStorage = {
    createPresignedUploadUrl: vi.fn(),
    readObjectSha256: vi.fn(),
    createPresignedDownloadUrl: vi.fn(),
  };
  const unusedDiagServiceClient = { parseDtcFile: vi.fn(), analyzeWotFile: vi.fn() };
  const unusedEmailSender = { sendInvitationEmail: vi.fn() };

  function buildTestApp(overrides: { tenantFindMany?: ReturnType<typeof vi.fn> } = {}) {
    const prisma = {
      $extends: () => ({}),
      tenant: { findMany: overrides.tenantFindMany ?? vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    return buildApp(prisma, {
      jwtSecret,
      storage: unusedStorage,
      diagServiceClient: unusedDiagServiceClient,
      emailSender: unusedEmailSender,
      webAppBaseUrl: "https://app.example.test",
    });
  }

  it("SUPER_ADMIN olmayan bir rol (OWNER) /admin/tenants'a 403 alır — platform-admin route'ları yalnızca SUPER_ADMIN'e açık", async () => {
    const app = buildTestApp();
    const ownerToken = signAccessToken({ userId: "owner-1", tenantId: "tenant-A", role: Role.OWNER }, jwtSecret);

    const response = await app.inject({
      method: "GET",
      url: "/admin/tenants",
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(response.statusCode).toBe(403);
  });

  it("SUPER_ADMIN, WORKSHOP_ROLES gerektiren bir tenant route'una (iş emirleri) 403 alır — platform-admin normal tenant iş akışlarına sızamaz", async () => {
    const app = buildTestApp();
    const superAdminToken = signAccessToken(
      { userId: "admin-1", tenantId: "platform-tenant-1", role: Role.SUPER_ADMIN },
      jwtSecret,
    );

    const response = await app.inject({
      method: "GET",
      url: "/work-orders",
      headers: { authorization: `Bearer ${superAdminToken}` },
    });

    expect(response.statusCode).toBe(403);
  });
});

describe("Bayi bağlama + kredi — kendi kendine onay/yükleme engeli (ADR 0013)", () => {
  const hubTenantId = "hub-security-1";
  const dealerTenantId = "dealer-security-1";
  const dealerAccountId = "link-security-1";

  it("hub OWNER'ı kendi önerdiği bağlantıyı onaylayamaz/reddedemez (DealerLinkNotFoundError — 'yokmuş' gibi davranır)", async () => {
    const findUnique = vi.fn<DealerLinkDb["dealerAccount"]["findUnique"]>();
    findUnique.mockResolvedValue({
      id: dealerAccountId,
      hubTenantId,
      dealerTenantId,
      status: "PENDING",
      requestedBy: "hub-owner-1",
      approvedBy: null,
      respondedAt: null,
      creditBalanceKurus: 0,
      createdAt: new Date(),
    });
    const updateMany = vi.fn<DealerLinkDb["dealerAccount"]["updateMany"]>();
    const db: DealerLinkDb = {
      tenant: { findUnique: vi.fn() },
      dealerAccount: { findFirst: vi.fn(), create: vi.fn(), findUnique, updateMany, findMany: vi.fn() },
    };
    const hubOwner = { id: "hub-owner-1", tenantId: hubTenantId, role: Role.OWNER };

    await expect(respondToDealerLink(db, hubOwner, dealerAccountId, true)).rejects.toBeInstanceOf(
      DealerLinkNotFoundError,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("dealer OWNER'ı (hub tarafı olmayan) kendi bayi hesabına kredi yükleyemez", async () => {
    const findUnique = vi.fn<DealerCreditTopupDb["dealerAccount"]["findUnique"]>();
    findUnique.mockResolvedValue({
      id: dealerAccountId,
      hubTenantId,
      dealerTenantId,
      status: "ACTIVE",
      creditBalanceKurus: 10_000,
    });
    const update = vi.fn<DealerCreditTopupDb["dealerAccount"]["update"]>();
    const db: DealerCreditTopupDb = {
      dealerAccount: { findUnique, update },
      dealerCreditTransaction: { create: vi.fn() },
    };
    const dealerOwner = { id: "dealer-owner-1", tenantId: dealerTenantId, role: Role.OWNER };

    await expect(topUpDealerCredit(db, dealerOwner, dealerAccountId, 5000)).rejects.toBeInstanceOf(
      DealerLinkNotFoundError,
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe("Davet enumeration direnci (ADR 0011)", () => {
  it("Tenant B'nin daveti, Tenant A'nın kullanıcısınca tahmin edilen/yanlış bir token ile redeem edilemez — generic InvalidInvitationTokenError", async () => {
    // Saldırgan gerçek (Tenant B'ye ait) tokenHash'i bilmiyor — kendi
    // tahmin ettiği ham token'ın hash'i DB'deki hiçbir kayıtla eşleşmiyor.
    const findUnique = vi.fn<InvitationRedemptionDb["invitation"]["findUnique"]>();
    findUnique.mockResolvedValue(null);
    const db: InvitationRedemptionDb = {
      invitation: { findUnique, updateMany: vi.fn() },
      user: { create: vi.fn() },
    };

    await expect(
      redeemInvitation(db, "guessed-token-does-not-exist", "saldirgan-sifresi-123"),
    ).rejects.toBeInstanceOf(InvalidInvitationTokenError);
  });
});

describe("Kiracı-içi kullanıcı yönetimi — çapraz tenant erişimi (ADR 0012)", () => {
  const tenantA = "tenant-A-mgmt";
  const tenantB = "tenant-B-mgmt-victim";

  function createMockDb() {
    const findUnique = vi.fn<UserManagementDb["user"]["findUnique"]>();
    const update = vi.fn<UserManagementDb["user"]["update"]>();
    const count = vi.fn<UserManagementDb["user"]["count"]>();
    const auditCreate = vi.fn<UserManagementDb["userManagementAuditLog"]["create"]>();
    const refreshTokenUpdateMany = vi.fn<UserManagementDb["refreshToken"]["updateMany"]>();
    const db: UserManagementDb = {
      user: { findUnique, update, count },
      userManagementAuditLog: { create: auditCreate },
      refreshToken: { updateMany: refreshTokenUpdateMany },
    };
    return { db, findUnique, update, refreshTokenUpdateMany };
  }

  it("Tenant A'nın OWNER'ı, Tenant B'ye ait bir kullanıcının rolünü değiştiremez — UserNotFoundError (404 eşdeğeri, 'yokmuş' gibi davranır)", async () => {
    const { db, findUnique, update } = createMockDb();
    findUnique.mockResolvedValue({ id: "victim-user", tenantId: tenantB, role: Role.ENGINEER, deactivatedAt: null });
    const attackerOwner = { id: "attacker-owner", tenantId: tenantA, role: Role.OWNER };

    await expect(changeUserRole(db, attackerOwner, "victim-user", Role.RECEPTIONIST)).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("Tenant A'nın OWNER'ı, Tenant B'ye ait bir kullanıcıyı deaktive edemez — UserNotFoundError", async () => {
    const { db, findUnique, update } = createMockDb();
    findUnique.mockResolvedValue({ id: "victim-user", tenantId: tenantB, role: Role.ENGINEER, deactivatedAt: null });
    const attackerOwner = { id: "attacker-owner", tenantId: tenantA, role: Role.OWNER };

    await expect(deactivateUser(db, attackerOwner, "victim-user")).rejects.toBeInstanceOf(UserNotFoundError);
    expect(update).not.toHaveBeenCalled();
  });

  it("deaktive edilen kullanıcının MEVCUT refresh token'ı anında reddedilir; MEVCUT access token'ı (≤15dk kalan TTL) stateless JWT olduğu için yeniden kontrol edilmez — bu kabul edilen bir davranış, boşluk değil", async () => {
    const { db, findUnique, refreshTokenUpdateMany } = createMockDb();
    findUnique.mockResolvedValue({ id: "victim-user", tenantId: tenantA, role: Role.ENGINEER, deactivatedAt: null });
    const owner = { id: "owner-1", tenantId: tenantA, role: Role.OWNER };

    // Deaktivasyondan HEMEN ÖNCE imzalanmış bir access token — sistemin
    // zaten kabul ettiği "çalıntı access token" penceresiyle aynı risk.
    const preDeactivationAccessToken = signAccessToken(
      { userId: "victim-user", tenantId: tenantA, role: Role.ENGINEER },
      "shared-secret",
    );

    await deactivateUser(db, owner, "victim-user");

    // 1) Refresh token'lar anında iptal edildi (bkz. ADR 0012).
    expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: { userId: "victim-user", revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });

    // 2) Buna KARŞIN, deaktivasyondan önce imzalanan access token hâlâ
    // kriptografik olarak geçerli görünüyor (JWT durum tutmuyor) — bu satır
    // bilinen/kabul edilen davranışı belgeliyor, bir regresyon testi değil.
    expect(verifyAccessToken(preDeactivationAccessToken, "shared-secret")).toEqual({
      userId: "victim-user",
      tenantId: tenantA,
      role: Role.ENGINEER,
    });

    // 3) Ama refresh ile yenilenmeye çalışıldığında artık reddedilir —
    // saldırı penceresi en fazla mevcut access token'ın kalan TTL'i (≤15dk) ile sınırlı.
    const refreshDb: AuthRefreshDb = {
      refreshToken: {
        findUnique: vi.fn().mockResolvedValue({
          id: "rt-1",
          userId: "victim-user",
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(), // deactivateUser'ın az önce yaptığı iptal
        }),
        update: vi.fn(),
        create: vi.fn(),
        updateMany: vi.fn(),
      },
      user: { findUnique: vi.fn() },
    };
    await expect(refreshTokens(refreshDb, "shared-secret", "victims-refresh-token")).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
  });
});
