import { describe, expect, it, vi } from "vitest";
import {
  fulfillFileRequest,
  InsufficientCreditError,
  MissingRequestCostError,
  type FulfillFileRequestDb,
} from "./fileRequestFulfillment.service.js";
import { ForbiddenRoleError, FileRequestNotFoundError } from "./fileRequest.service.js";
import { InvalidFileRequestTransitionError } from "./fileRequestStatus.machine.js";
import { Role, EcuFileType } from "../../generated/prisma/enums.js";
import type { EcuFileDb } from "../ecufile/ecuFile.service.js";

const hubTenantId = "hub-1";
const dealerTenantId = "dealer-1";
const fileRequestId = "req-1";
const dealerAccountId = "acct-1";
const vehicleId = "vehicle-1";
const readFileId = "read-file-1";

const hubEngineer = { id: "hub-engineer-1", tenantId: hubTenantId, role: Role.ENGINEER };

function createMockDb() {
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

  return {
    db,
    fileRequestFindUnique,
    fileRequestUpdate,
    dealerAccountFindUnique,
    dealerAccountUpdate,
    dealerCreditTransactionCreate,
    auditCreate,
  };
}

function createMockEcuFileDb() {
  const ecuFileCreate = vi.fn<EcuFileDb["ecuFile"]["create"]>();
  const ecuFileFindUnique = vi.fn<EcuFileDb["ecuFile"]["findUnique"]>();
  // createEcuFile, stockRomRef=readFileId'nin geçerli bir ORIGINAL_STOCK
  // dosyası olduğunu bu sorguyla doğrular (bkz. ecuFile.service.ts).
  ecuFileFindUnique.mockResolvedValue({
    id: readFileId,
    vehicleId,
    fileType: EcuFileType.ORIGINAL_STOCK,
  });
  const vehicleFindUnique = vi.fn<EcuFileDb["vehicle"]["findUnique"]>();
  vehicleFindUnique.mockResolvedValue({ id: vehicleId });
  const ecuFileDb: EcuFileDb = {
    vehicle: { findUnique: vehicleFindUnique },
    ecuFile: { create: ecuFileCreate, findUnique: ecuFileFindUnique },
  };
  return { ecuFileDb, ecuFileCreate, ecuFileFindUnique, vehicleFindUnique };
}

function baseParams(overrides: Partial<Parameters<typeof fulfillFileRequest>[1]> = {}) {
  return {
    fileRequestId,
    hubTenantId,
    actingUser: hubEngineer,
    storageKey: "s3://calibrated/stage1.bin",
    checksum: "checksum-abc",
    ...overrides,
  };
}

function inProgressRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: fileRequestId,
    hubTenantId,
    dealerTenantId,
    dealerAccountId,
    vehicleId,
    readFileId,
    requestedStage: EcuFileType.STAGE1,
    status: "IN_PROGRESS" as const,
    costKurus: 5000,
    ...overrides,
  };
}

describe("fulfillFileRequest", () => {
  it("scopeEcuFileToDealerTenant, FETCHED fileRequest.dealerTenantId ile çağrılır — hub'ın kendi tenant'ı DEĞİL", async () => {
    const dbDeps = createMockDb();
    dbDeps.fileRequestFindUnique.mockResolvedValue(inProgressRequest());
    dbDeps.dealerAccountFindUnique.mockResolvedValue({
      id: dealerAccountId,
      creditBalanceKurus: 20000,
    });
    const { ecuFileDb, ecuFileCreate } = createMockEcuFileDb();
    ecuFileCreate.mockResolvedValue({ id: "result-file-1" });
    const scopeEcuFileToDealerTenant = vi.fn().mockReturnValue(ecuFileDb);

    await fulfillFileRequest(
      { db: dbDeps.db, scopeEcuFileToDealerTenant },
      baseParams(),
    );

    expect(scopeEcuFileToDealerTenant).toHaveBeenCalledWith(dealerTenantId);
    expect(scopeEcuFileToDealerTenant).not.toHaveBeenCalledWith(hubTenantId);
  });

  it("hub OWNER/ENGINEER dışı bir kullanıcı fulfil edemez, hiçbir yan etki oluşmaz", async () => {
    const dbDeps = createMockDb();
    const { ecuFileDb, ecuFileCreate } = createMockEcuFileDb();
    const scopeEcuFileToDealerTenant = vi.fn().mockReturnValue(ecuFileDb);
    const dealerUser = { id: "dealer-user", tenantId: dealerTenantId, role: Role.DEALER };

    await expect(
      fulfillFileRequest(
        { db: dbDeps.db, scopeEcuFileToDealerTenant },
        baseParams({ actingUser: dealerUser }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenRoleError);
    expect(ecuFileCreate).not.toHaveBeenCalled();
    expect(dbDeps.dealerAccountUpdate).not.toHaveBeenCalled();
    expect(scopeEcuFileToDealerTenant).not.toHaveBeenCalled();
  });

  it("talep bulunamazsa FileRequestNotFoundError fırlatır", async () => {
    const dbDeps = createMockDb();
    dbDeps.fileRequestFindUnique.mockResolvedValue(null);
    const { ecuFileDb, ecuFileCreate } = createMockEcuFileDb();
    const scopeEcuFileToDealerTenant = vi.fn().mockReturnValue(ecuFileDb);

    await expect(
      fulfillFileRequest({ db: dbDeps.db, scopeEcuFileToDealerTenant }, baseParams()),
    ).rejects.toBeInstanceOf(FileRequestNotFoundError);
    expect(ecuFileCreate).not.toHaveBeenCalled();
  });

  it("talep IN_PROGRESS değilse InvalidFileRequestTransitionError fırlatır, hiçbir yan etki oluşmaz", async () => {
    const dbDeps = createMockDb();
    dbDeps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ status: "PENDING" }));
    const { ecuFileDb, ecuFileCreate } = createMockEcuFileDb();
    const scopeEcuFileToDealerTenant = vi.fn().mockReturnValue(ecuFileDb);

    await expect(
      fulfillFileRequest({ db: dbDeps.db, scopeEcuFileToDealerTenant }, baseParams()),
    ).rejects.toBeInstanceOf(InvalidFileRequestTransitionError);
    expect(ecuFileCreate).not.toHaveBeenCalled();
    expect(dbDeps.dealerAccountUpdate).not.toHaveBeenCalled();
    expect(dbDeps.dealerCreditTransactionCreate).not.toHaveBeenCalled();
    expect(dbDeps.fileRequestUpdate).not.toHaveBeenCalled();
    expect(dbDeps.auditCreate).not.toHaveBeenCalled();
  });

  it("costKurus atanmamışsa MissingRequestCostError fırlatır, hiçbir yan etki oluşmaz", async () => {
    const dbDeps = createMockDb();
    dbDeps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ costKurus: null }));
    const { ecuFileDb, ecuFileCreate } = createMockEcuFileDb();
    const scopeEcuFileToDealerTenant = vi.fn().mockReturnValue(ecuFileDb);

    await expect(
      fulfillFileRequest({ db: dbDeps.db, scopeEcuFileToDealerTenant }, baseParams()),
    ).rejects.toBeInstanceOf(MissingRequestCostError);
    expect(ecuFileCreate).not.toHaveBeenCalled();
  });

  it("yetersiz kredi bakiyesinde InsufficientCreditError fırlatır — dosya oluşmaz, kredi düşmez, durum değişmez", async () => {
    const dbDeps = createMockDb();
    dbDeps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ costKurus: 5000 }));
    dbDeps.dealerAccountFindUnique.mockResolvedValue({
      id: dealerAccountId,
      creditBalanceKurus: 4999,
    });
    const { ecuFileDb, ecuFileCreate } = createMockEcuFileDb();
    const scopeEcuFileToDealerTenant = vi.fn().mockReturnValue(ecuFileDb);

    await expect(
      fulfillFileRequest({ db: dbDeps.db, scopeEcuFileToDealerTenant }, baseParams()),
    ).rejects.toBeInstanceOf(InsufficientCreditError);
    expect(ecuFileCreate).not.toHaveBeenCalled();
    expect(dbDeps.dealerAccountUpdate).not.toHaveBeenCalled();
    expect(dbDeps.dealerCreditTransactionCreate).not.toHaveBeenCalled();
    expect(dbDeps.fileRequestUpdate).not.toHaveBeenCalled();
    expect(dbDeps.auditCreate).not.toHaveBeenCalled();
  });

  it("bakiye tam maliyete eşitse (sınır durumu) izin verilir, bakiye 0'a iner", async () => {
    const dbDeps = createMockDb();
    dbDeps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ costKurus: 5000 }));
    dbDeps.dealerAccountFindUnique.mockResolvedValue({
      id: dealerAccountId,
      creditBalanceKurus: 5000,
    });
    const { ecuFileDb, ecuFileCreate } = createMockEcuFileDb();
    ecuFileCreate.mockResolvedValue({ id: "result-file-1" });
    const scopeEcuFileToDealerTenant = vi.fn().mockReturnValue(ecuFileDb);

    await fulfillFileRequest({ db: dbDeps.db, scopeEcuFileToDealerTenant }, baseParams());

    expect(dbDeps.dealerAccountUpdate).toHaveBeenCalledWith({
      where: { id: dealerAccountId },
      data: { creditBalanceKurus: 0 },
    });
    expect(dbDeps.dealerCreditTransactionCreate).toHaveBeenCalledWith({
      data: {
        dealerAccountId,
        amountKurus: -5000,
        balanceAfterKurus: 0,
        fileRequestId,
      },
    });
  });

  it("yeterli bakiyede: kalibre dosya dealer-scoped db üzerinden oluşturulur, kredi düşer, durum FULFILLED olur, audit log yazılır", async () => {
    const dbDeps = createMockDb();
    dbDeps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ costKurus: 5000 }));
    dbDeps.dealerAccountFindUnique.mockResolvedValue({
      id: dealerAccountId,
      creditBalanceKurus: 20000,
    });
    const { ecuFileDb, ecuFileCreate } = createMockEcuFileDb();
    ecuFileCreate.mockResolvedValue({ id: "result-file-1" });
    const scopeEcuFileToDealerTenant = vi.fn().mockReturnValue(ecuFileDb);

    await fulfillFileRequest({ db: dbDeps.db, scopeEcuFileToDealerTenant }, baseParams());

    expect(ecuFileCreate).toHaveBeenCalledWith({
      // expect.objectContaining() tipi vitest'te `any` döner (bilinen tip boşluğu).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        vehicleId,
        fileType: EcuFileType.STAGE1,
        stockRomRef: readFileId,
        storageKey: "s3://calibrated/stage1.bin",
        checksum: "checksum-abc",
        uploadedBy: hubEngineer.id,
      }),
    });
    expect(dbDeps.dealerAccountUpdate).toHaveBeenCalledWith({
      where: { id: dealerAccountId },
      data: { creditBalanceKurus: 15000 },
    });
    expect(dbDeps.dealerCreditTransactionCreate).toHaveBeenCalledWith({
      data: {
        dealerAccountId,
        amountKurus: -5000,
        balanceAfterKurus: 15000,
        fileRequestId,
      },
    });
    expect(dbDeps.fileRequestUpdate).toHaveBeenCalledWith({
      where: { id: fileRequestId },
      data: { status: "FULFILLED", resultFileId: "result-file-1", processedBy: hubEngineer.id },
    });
    expect(dbDeps.auditCreate).toHaveBeenCalledWith({
      data: {
        fileRequestId,
        hubTenantId,
        dealerTenantId,
        fromStatus: "IN_PROGRESS",
        toStatus: "FULFILLED",
        changedBy: hubEngineer.id,
      },
    });
  });
});
