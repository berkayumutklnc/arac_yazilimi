import { describe, expect, it, vi } from "vitest";
import {
  fulfillFileRequest,
  InsufficientCreditError,
  MissingRequestCostError,
  type FulfillFileRequestDb,
} from "./fileRequestFulfillment.service.js";
import {
  ForbiddenRoleError,
  FileRequestNotFoundError,
} from "./fileRequest.service.js";
import { InvalidFileRequestTransitionError } from "./fileRequestStatus.machine.js";
import { Role, EcuFileType } from "../../generated/prisma/enums.js";

const hubTenantId = "hub-1";
const dealerTenantId = "dealer-1";
const fileRequestId = "req-1";
const dealerAccountId = "acct-1";
const vehicleId = "vehicle-1";
const readFileId = "read-file-1";

const hubEngineer = { id: "hub-engineer-1", tenantId: hubTenantId, role: Role.ENGINEER };

function createMockDb() {
  const ecuFileCreate = vi.fn<FulfillFileRequestDb["ecuFile"]["create"]>();
  const ecuFileFindUnique = vi.fn<FulfillFileRequestDb["ecuFile"]["findUnique"]>();
  const fileRequestFindUnique = vi.fn<FulfillFileRequestDb["fileRequest"]["findUnique"]>();
  const fileRequestUpdate = vi.fn<FulfillFileRequestDb["fileRequest"]["update"]>();
  const dealerAccountFindUnique = vi.fn<FulfillFileRequestDb["dealerAccount"]["findUnique"]>();
  const dealerAccountUpdate = vi.fn<FulfillFileRequestDb["dealerAccount"]["update"]>();
  const dealerCreditTransactionCreate =
    vi.fn<FulfillFileRequestDb["dealerCreditTransaction"]["create"]>();
  const auditCreate = vi.fn<FulfillFileRequestDb["fileRequestStatusAuditLog"]["create"]>();
  const vehicleFindUnique = vi.fn<FulfillFileRequestDb["vehicle"]["findUnique"]>();
  vehicleFindUnique.mockResolvedValue({ id: vehicleId });

  const db: FulfillFileRequestDb = {
    vehicle: { findUnique: vehicleFindUnique },
    ecuFile: { create: ecuFileCreate, findUnique: ecuFileFindUnique },
    fileRequest: { findUnique: fileRequestFindUnique, update: fileRequestUpdate },
    dealerAccount: { findUnique: dealerAccountFindUnique, update: dealerAccountUpdate },
    dealerCreditTransaction: { create: dealerCreditTransactionCreate },
    fileRequestStatusAuditLog: { create: auditCreate },
  };

  return {
    db,
    ecuFileCreate,
    ecuFileFindUnique,
    fileRequestFindUnique,
    fileRequestUpdate,
    dealerAccountFindUnique,
    dealerAccountUpdate,
    vehicleFindUnique,
    dealerCreditTransactionCreate,
    auditCreate,
  };
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
  it("hub OWNER/ENGINEER dışı bir kullanıcı fulfil edemez, hiçbir yan etki oluşmaz", async () => {
    const deps = createMockDb();
    const dealerUser = { id: "dealer-user", tenantId: dealerTenantId, role: Role.DEALER };

    await expect(
      fulfillFileRequest(deps.db, baseParams({ actingUser: dealerUser })),
    ).rejects.toBeInstanceOf(ForbiddenRoleError);
    expect(deps.ecuFileCreate).not.toHaveBeenCalled();
    expect(deps.dealerAccountUpdate).not.toHaveBeenCalled();
  });

  it("talep bulunamazsa FileRequestNotFoundError fırlatır", async () => {
    const deps = createMockDb();
    deps.fileRequestFindUnique.mockResolvedValue(null);

    await expect(fulfillFileRequest(deps.db, baseParams())).rejects.toBeInstanceOf(
      FileRequestNotFoundError,
    );
    expect(deps.ecuFileCreate).not.toHaveBeenCalled();
  });

  it("talep IN_PROGRESS değilse InvalidFileRequestTransitionError fırlatır, hiçbir yan etki oluşmaz", async () => {
    const deps = createMockDb();
    deps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ status: "PENDING" }));

    await expect(fulfillFileRequest(deps.db, baseParams())).rejects.toBeInstanceOf(
      InvalidFileRequestTransitionError,
    );
    expect(deps.ecuFileCreate).not.toHaveBeenCalled();
    expect(deps.dealerAccountUpdate).not.toHaveBeenCalled();
    expect(deps.dealerCreditTransactionCreate).not.toHaveBeenCalled();
    expect(deps.fileRequestUpdate).not.toHaveBeenCalled();
    expect(deps.auditCreate).not.toHaveBeenCalled();
  });

  it("costKurus atanmamışsa MissingRequestCostError fırlatır, hiçbir yan etki oluşmaz", async () => {
    const deps = createMockDb();
    deps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ costKurus: null }));

    await expect(fulfillFileRequest(deps.db, baseParams())).rejects.toBeInstanceOf(
      MissingRequestCostError,
    );
    expect(deps.ecuFileCreate).not.toHaveBeenCalled();
  });

  it("yetersiz kredi bakiyesinde InsufficientCreditError fırlatır — dosya oluşmaz, kredi düşmez, durum değişmez", async () => {
    const deps = createMockDb();
    deps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ costKurus: 5000 }));
    deps.dealerAccountFindUnique.mockResolvedValue({
      id: dealerAccountId,
      creditBalanceKurus: 4999,
    });

    await expect(fulfillFileRequest(deps.db, baseParams())).rejects.toBeInstanceOf(
      InsufficientCreditError,
    );
    expect(deps.ecuFileCreate).not.toHaveBeenCalled();
    expect(deps.dealerAccountUpdate).not.toHaveBeenCalled();
    expect(deps.dealerCreditTransactionCreate).not.toHaveBeenCalled();
    expect(deps.fileRequestUpdate).not.toHaveBeenCalled();
    expect(deps.auditCreate).not.toHaveBeenCalled();
  });

  it("bakiye tam maliyete eşitse (sınır durumu) izin verilir, bakiye 0'a iner", async () => {
    const deps = createMockDb();
    deps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ costKurus: 5000 }));
    deps.dealerAccountFindUnique.mockResolvedValue({
      id: dealerAccountId,
      creditBalanceKurus: 5000,
    });
    deps.ecuFileFindUnique.mockResolvedValue({
      id: readFileId,
      tenantId: dealerTenantId,
      vehicleId,
      fileType: EcuFileType.ORIGINAL_STOCK,
    });
    deps.ecuFileCreate.mockResolvedValue({ id: "result-file-1" });

    await fulfillFileRequest(deps.db, baseParams());

    expect(deps.dealerAccountUpdate).toHaveBeenCalledWith({
      where: { id: dealerAccountId },
      data: { creditBalanceKurus: 0 },
    });
    expect(deps.dealerCreditTransactionCreate).toHaveBeenCalledWith({
      data: {
        dealerAccountId,
        amountKurus: -5000,
        balanceAfterKurus: 0,
        fileRequestId,
      },
    });
  });

  it("yeterli bakiyede: kalibre dosya dealer tenant'ında oluşturulur, kredi düşer, durum FULFILLED olur, audit log yazılır", async () => {
    const deps = createMockDb();
    deps.fileRequestFindUnique.mockResolvedValue(inProgressRequest({ costKurus: 5000 }));
    deps.dealerAccountFindUnique.mockResolvedValue({
      id: dealerAccountId,
      creditBalanceKurus: 20000,
    });
    deps.ecuFileFindUnique.mockResolvedValue({
      id: readFileId,
      tenantId: dealerTenantId,
      vehicleId,
      fileType: EcuFileType.ORIGINAL_STOCK,
    });
    deps.ecuFileCreate.mockResolvedValue({ id: "result-file-1" });

    await fulfillFileRequest(deps.db, baseParams());

    expect(deps.ecuFileCreate).toHaveBeenCalledWith({
      // expect.objectContaining() tipi vitest'te `any` döner (bilinen tip boşluğu).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        tenantId: dealerTenantId,
        vehicleId,
        fileType: EcuFileType.STAGE1,
        stockRomRef: readFileId,
        storageKey: "s3://calibrated/stage1.bin",
        checksum: "checksum-abc",
        uploadedBy: hubEngineer.id,
      }),
    });
    expect(deps.dealerAccountUpdate).toHaveBeenCalledWith({
      where: { id: dealerAccountId },
      data: { creditBalanceKurus: 15000 },
    });
    expect(deps.dealerCreditTransactionCreate).toHaveBeenCalledWith({
      data: {
        dealerAccountId,
        amountKurus: -5000,
        balanceAfterKurus: 15000,
        fileRequestId,
      },
    });
    expect(deps.fileRequestUpdate).toHaveBeenCalledWith({
      where: { id: fileRequestId },
      data: { status: "FULFILLED", resultFileId: "result-file-1", processedBy: hubEngineer.id },
    });
    expect(deps.auditCreate).toHaveBeenCalledWith({
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
