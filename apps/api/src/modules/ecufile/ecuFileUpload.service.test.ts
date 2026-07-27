import { describe, expect, it, vi } from "vitest";
import {
  requestEcuFileUpload,
  confirmEcuFileUpload,
  IllegalContentDetectedError,
  ChecksumMismatchError,
  DuplicateEcuFileError,
  type EcuFileStoragePort,
  type EcuFileUploadDb,
} from "./ecuFileUpload.service.js";

const tenantId = "tenant-1";
const vehicleId = "vehicle-1";
const uploadedBy = "user-1";

function createMockStorage() {
  const createPresignedUploadUrl = vi.fn<EcuFileStoragePort["createPresignedUploadUrl"]>();
  const readObjectSha256 = vi.fn<EcuFileStoragePort["readObjectSha256"]>();
  const storage: EcuFileStoragePort = { createPresignedUploadUrl, readObjectSha256 };
  return { storage, createPresignedUploadUrl, readObjectSha256 };
}

function createMockDb() {
  const create = vi.fn<EcuFileUploadDb["ecuFile"]["create"]>();
  const findUnique = vi.fn<EcuFileUploadDb["ecuFile"]["findUnique"]>();
  const findFirst = vi.fn<EcuFileUploadDb["ecuFile"]["findFirst"]>();
  const vehicleFindUnique = vi.fn<EcuFileUploadDb["vehicle"]["findUnique"]>();
  vehicleFindUnique.mockResolvedValue({ id: vehicleId });
  const db: EcuFileUploadDb = {
    vehicle: { findUnique: vehicleFindUnique },
    ecuFile: { create, findUnique, findFirst },
  };
  return { db, create, findUnique, findFirst, vehicleFindUnique };
}

describe("requestEcuFileUpload", () => {
  it("dosya adında yasaklı kalıp varsa presigned URL üretmeden reddeder", async () => {
    const { storage, createPresignedUploadUrl } = createMockStorage();

    await expect(
      requestEcuFileUpload(storage, { tenantId, vehicleId, fileName: "dpf_off_stage1.bin" }),
    ).rejects.toBeInstanceOf(IllegalContentDetectedError);
    expect(createPresignedUploadUrl).not.toHaveBeenCalled();
  });

  it("meşru dosya adı için presigned upload URL üretir", async () => {
    const { storage, createPresignedUploadUrl } = createMockStorage();
    createPresignedUploadUrl.mockResolvedValue({
      uploadUrl: "https://s3.example.com/upload",
      key: "tenant-1/vehicle-1/stage1.bin",
    });

    const result = await requestEcuFileUpload(storage, {
      tenantId,
      vehicleId,
      fileName: "stage1_remap.bin",
    });

    expect(result.uploadUrl).toBe("https://s3.example.com/upload");
    expect(createPresignedUploadUrl).toHaveBeenCalledTimes(1);
  });
});

describe("confirmEcuFileUpload", () => {
  const storageKey = "tenant-1/vehicle-1/stage1.bin";

  it("sunucuda yeniden hesaplanan hash istemcininkiyle uyuşmuyorsa reddeder", async () => {
    const { storage, readObjectSha256 } = createMockStorage();
    readObjectSha256.mockResolvedValue("actual-hash");
    const { db, create, findFirst } = createMockDb();

    await expect(
      confirmEcuFileUpload(
        { db, storage },
        {
          tenantId,
          vehicleId,
          fileType: "STAGE1",
          storageKey,
          claimedChecksum: "claimed-hash",
          uploadedBy,
          stockRomRef: "stock-1",
        },
      ),
    ).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(findFirst).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it("aynı tenant+araç+hash için mükerrer dosya tespit edilirse reddeder", async () => {
    const { storage, readObjectSha256 } = createMockStorage();
    readObjectSha256.mockResolvedValue("same-hash");
    const { db, create, findFirst } = createMockDb();
    findFirst.mockResolvedValue({ id: "existing-file-id" });

    await expect(
      confirmEcuFileUpload(
        { db, storage },
        {
          tenantId,
          vehicleId,
          fileType: "STAGE1",
          storageKey,
          claimedChecksum: "same-hash",
          uploadedBy,
          stockRomRef: "stock-1",
        },
      ),
    ).rejects.toBeInstanceOf(DuplicateEcuFileError);
    expect(findFirst).toHaveBeenCalledWith({
      where: { tenantId, vehicleId, checksum: "same-hash" },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("hash doğrulanır, mükerrer yoksa kayıt sunucuda hesaplanan hash ile oluşturulur", async () => {
    const { storage, readObjectSha256 } = createMockStorage();
    readObjectSha256.mockResolvedValue("verified-hash");
    const { db, create, findFirst, findUnique } = createMockDb();
    findFirst.mockResolvedValue(null);
    findUnique.mockResolvedValue({
      id: "stock-1",
      tenantId,
      vehicleId,
      fileType: "ORIGINAL_STOCK",
    });
    create.mockResolvedValue({ id: "new-file-id" });

    await confirmEcuFileUpload(
      { db, storage },
      {
        tenantId,
        vehicleId,
        fileType: "STAGE1",
        storageKey,
        claimedChecksum: "verified-hash",
        uploadedBy,
        stockRomRef: "stock-1",
      },
    );

    expect(create).toHaveBeenCalledWith({
      // expect.objectContaining() tipi vitest'te `any` döner (bilinen tip boşluğu).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        checksum: "verified-hash",
        storageKey,
        uploadedBy,
      }),
    });
  });
});
