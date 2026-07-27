import { describe, expect, it, vi } from "vitest";
import {
  createFileRequest,
  transitionFileRequestStatus,
  ForbiddenRoleError,
  DealerAccountNotFoundError,
  FileRequestNotFoundError,
  MissingCostError,
  type FileRequestDb,
} from "./fileRequest.service.js";
import { InvalidFileRequestTransitionError } from "./fileRequestStatus.machine.js";
import { Role, EcuFileType } from "../../generated/prisma/enums.js";

const hubTenantId = "hub-1";
const dealerTenantId = "dealer-1";
const fileRequestId = "req-1";

function createMockDb() {
  const dealerAccountFindFirst = vi.fn<FileRequestDb["dealerAccount"]["findFirst"]>();
  const fileRequestCreate = vi.fn<FileRequestDb["fileRequest"]["create"]>();
  const fileRequestFindUnique = vi.fn<FileRequestDb["fileRequest"]["findUnique"]>();
  const fileRequestUpdate = vi.fn<FileRequestDb["fileRequest"]["update"]>();
  const auditCreate = vi.fn<FileRequestDb["fileRequestStatusAuditLog"]["create"]>();
  const db: FileRequestDb = {
    dealerAccount: { findFirst: dealerAccountFindFirst },
    fileRequest: {
      create: fileRequestCreate,
      findUnique: fileRequestFindUnique,
      update: fileRequestUpdate,
    },
    fileRequestStatusAuditLog: { create: auditCreate },
  };
  return {
    db,
    dealerAccountFindFirst,
    fileRequestCreate,
    fileRequestFindUnique,
    fileRequestUpdate,
    auditCreate,
  };
}

const dealerUser = { id: "dealer-user-1", tenantId: dealerTenantId, role: Role.DEALER };
const hubOwner = { id: "hub-owner-1", tenantId: hubTenantId, role: Role.OWNER };
const hubEngineer = { id: "hub-engineer-1", tenantId: hubTenantId, role: Role.ENGINEER };

describe("createFileRequest", () => {
  const baseInput = {
    hubTenantId,
    vehicleId: "vehicle-1",
    readFileId: "read-file-1",
    requestedStage: EcuFileType.STAGE1,
  };

  it("DEALER olmayan bir rol talep açamaz", async () => {
    const { db, fileRequestCreate } = createMockDb();

    await expect(createFileRequest(db, hubOwner, baseInput)).rejects.toBeInstanceOf(
      ForbiddenRoleError,
    );
    expect(fileRequestCreate).not.toHaveBeenCalled();
  });

  it("hub ile arasında kredi hesabı yoksa DealerAccountNotFoundError fırlatır", async () => {
    const { db, dealerAccountFindFirst, fileRequestCreate } = createMockDb();
    dealerAccountFindFirst.mockResolvedValue(null);

    await expect(createFileRequest(db, dealerUser, baseInput)).rejects.toBeInstanceOf(
      DealerAccountNotFoundError,
    );
    expect(fileRequestCreate).not.toHaveBeenCalled();
  });

  it("ORIGINAL_STOCK stage olarak talep edilemez", async () => {
    const { db, dealerAccountFindFirst, fileRequestCreate } = createMockDb();
    dealerAccountFindFirst.mockResolvedValue({
      id: "acct-1",
      hubTenantId,
      dealerTenantId,
      creditBalanceKurus: 10000,
    });

    // Tip sistemi refine sonrası ORIGINAL_STOCK'u zaten dışlıyor; burada zod'un
    // çalışma zamanında da reddettiğini kanıtlamak için kasıtlı olarak tip dışına çıkıyoruz.
    const invalidInput = {
      ...baseInput,
      requestedStage: EcuFileType.ORIGINAL_STOCK,
    } as unknown as Parameters<typeof createFileRequest>[2];

    await expect(createFileRequest(db, dealerUser, invalidInput)).rejects.toThrow();
    expect(fileRequestCreate).not.toHaveBeenCalled();
  });

  it("geçerli talep dealerTenantId'yi actingUser'dan alarak PENDING olarak oluşturulur", async () => {
    const { db, dealerAccountFindFirst, fileRequestCreate } = createMockDb();
    dealerAccountFindFirst.mockResolvedValue({
      id: "acct-1",
      hubTenantId,
      dealerTenantId,
      creditBalanceKurus: 10000,
    });
    fileRequestCreate.mockResolvedValue({ id: fileRequestId });

    await createFileRequest(db, dealerUser, baseInput);

    expect(fileRequestCreate).toHaveBeenCalledWith({
      // expect.objectContaining() tipi vitest'te `any` döner (bilinen tip boşluğu).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        hubTenantId,
        dealerTenantId,
        dealerAccountId: "acct-1",
        status: "PENDING",
        requestedBy: dealerUser.id,
      }),
    });
  });
});

describe("transitionFileRequestStatus", () => {
  it("hub OWNER/ENGINEER dışındaki bir kullanıcı talebi işleyemez", async () => {
    const { db, fileRequestFindUnique, fileRequestUpdate } = createMockDb();

    await expect(
      transitionFileRequestStatus(db, {
        fileRequestId,
        hubTenantId,
        toStatus: "ACCEPTED",
        actingUser: dealerUser,
        costKurus: 5000,
      }),
    ).rejects.toBeInstanceOf(ForbiddenRoleError);
    expect(fileRequestFindUnique).not.toHaveBeenCalled();
    expect(fileRequestUpdate).not.toHaveBeenCalled();
  });

  it("başka bir tenant'ın OWNER'ı işleyemez (tenant izolasyonu)", async () => {
    const { db, fileRequestUpdate } = createMockDb();
    const otherHubOwner = { id: "other-owner", tenantId: "other-tenant", role: Role.OWNER };

    await expect(
      transitionFileRequestStatus(db, {
        fileRequestId,
        hubTenantId,
        toStatus: "ACCEPTED",
        actingUser: otherHubOwner,
        costKurus: 5000,
      }),
    ).rejects.toBeInstanceOf(ForbiddenRoleError);
    expect(fileRequestUpdate).not.toHaveBeenCalled();
  });

  it("talep bulunamazsa veya başka bir hub'a aitse FileRequestNotFoundError fırlatır", async () => {
    const { db, fileRequestFindUnique, fileRequestUpdate } = createMockDb();
    fileRequestFindUnique.mockResolvedValue(null);

    await expect(
      transitionFileRequestStatus(db, {
        fileRequestId,
        hubTenantId,
        toStatus: "ACCEPTED",
        actingUser: hubOwner,
        costKurus: 5000,
      }),
    ).rejects.toBeInstanceOf(FileRequestNotFoundError);
    expect(fileRequestUpdate).not.toHaveBeenCalled();
  });

  it("geçersiz durum geçişinde InvalidFileRequestTransitionError fırlatır, update/audit yazılmaz", async () => {
    const { db, fileRequestFindUnique, fileRequestUpdate, auditCreate } = createMockDb();
    fileRequestFindUnique.mockResolvedValue({ id: fileRequestId, hubTenantId, dealerTenantId, status: "PENDING" });

    await expect(
      transitionFileRequestStatus(db, {
        fileRequestId,
        hubTenantId,
        toStatus: "FULFILLED",
        actingUser: hubOwner,
      }),
    ).rejects.toBeInstanceOf(InvalidFileRequestTransitionError);
    expect(fileRequestUpdate).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("ACCEPTED geçişinde costKurus verilmezse MissingCostError fırlatır", async () => {
    const { db, fileRequestFindUnique, fileRequestUpdate } = createMockDb();
    fileRequestFindUnique.mockResolvedValue({ id: fileRequestId, hubTenantId, dealerTenantId, status: "PENDING" });

    await expect(
      transitionFileRequestStatus(db, {
        fileRequestId,
        hubTenantId,
        toStatus: "ACCEPTED",
        actingUser: hubEngineer,
      }),
    ).rejects.toBeInstanceOf(MissingCostError);
    expect(fileRequestUpdate).not.toHaveBeenCalled();
  });

  it("ACCEPTED geçişi costKurus ile günceller ve audit log yazar", async () => {
    const { db, fileRequestFindUnique, fileRequestUpdate, auditCreate } = createMockDb();
    fileRequestFindUnique.mockResolvedValue({ id: fileRequestId, hubTenantId, dealerTenantId, status: "PENDING" });

    await transitionFileRequestStatus(db, {
      fileRequestId,
      hubTenantId,
      toStatus: "ACCEPTED",
      actingUser: hubEngineer,
      costKurus: 15000,
    });

    expect(fileRequestUpdate).toHaveBeenCalledWith({
      where: { id: fileRequestId },
      data: { status: "ACCEPTED", processedBy: hubEngineer.id, costKurus: 15000 },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        fileRequestId,
        hubTenantId,
        dealerTenantId,
        fromStatus: "PENDING",
        toStatus: "ACCEPTED",
        changedBy: hubEngineer.id,
      },
    });
  });

  it("REJECTED geçişi costKurus gerektirmez", async () => {
    const { db, fileRequestFindUnique, fileRequestUpdate } = createMockDb();
    fileRequestFindUnique.mockResolvedValue({ id: fileRequestId, hubTenantId, dealerTenantId, status: "PENDING" });

    await transitionFileRequestStatus(db, {
      fileRequestId,
      hubTenantId,
      toStatus: "REJECTED",
      actingUser: hubOwner,
    });

    expect(fileRequestUpdate).toHaveBeenCalledWith({
      where: { id: fileRequestId },
      data: { status: "REJECTED", processedBy: hubOwner.id },
    });
  });
});
