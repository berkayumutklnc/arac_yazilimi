import { describe, expect, it, vi } from "vitest";
import { confirmEcuFileUploadTransactional } from "./ecuFileUploadTransactional.js";
import { DuplicateEcuFileError, ChecksumMismatchError } from "./ecuFileUpload.service.js";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";

const tenantId = "tenant-1";
const vehicleId = "vehicle-1";
const uploadedBy = "user-1";

function createFakeTx() {
  const vehicleFindUnique = vi.fn().mockResolvedValue({ id: vehicleId });
  const ecuFileFindFirst = vi.fn().mockResolvedValue(null);
  const ecuFileFindUnique = vi.fn().mockResolvedValue({
    id: "stock-1",
    vehicleId,
    fileType: "ORIGINAL_STOCK",
  });
  const ecuFileCreate = vi.fn().mockResolvedValue({ id: "new-file-id" });

  const tx = {
    vehicle: { findUnique: vehicleFindUnique },
    ecuFile: { create: ecuFileCreate, findUnique: ecuFileFindUnique, findFirst: ecuFileFindFirst },
  };
  return { tx, vehicleFindUnique, ecuFileFindFirst, ecuFileFindUnique, ecuFileCreate };
}

function createFakePrisma(tx: unknown, ecuFileFindFirstOnBaseClient?: ReturnType<typeof vi.fn>) {
  const $transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(tx));
  const prisma = {
    $transaction,
    ecuFile: { findFirst: ecuFileFindFirstOnBaseClient ?? vi.fn() },
  } as unknown as PrismaClient;
  return { prisma, $transaction };
}

function createMockStorage(checksum: string) {
  return { readObjectSha256: vi.fn().mockResolvedValue(checksum) };
}

function baseParams(overrides: Record<string, unknown> = {}) {
  return {
    vehicleId,
    fileType: "STAGE1" as const,
    storageKey: "tenant-1/vehicle-1/stage1.bin",
    claimedChecksum: "verified-hash",
    uploadedBy,
    stockRomRef: "stock-1",
    ...overrides,
  };
}

describe("confirmEcuFileUploadTransactional", () => {
  it("başarılı yüklemede prisma.$transaction içinde tenant'a scoped create çağrılır", async () => {
    const { tx, vehicleFindUnique, ecuFileCreate } = createFakeTx();
    const { prisma, $transaction } = createFakePrisma(tx);
    const storage = createMockStorage("verified-hash");

    await confirmEcuFileUploadTransactional(prisma, tenantId, storage, baseParams());

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(vehicleFindUnique).toHaveBeenCalledWith({ where: { id: vehicleId, tenantId } });
    const createArgs = ecuFileCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(createArgs.data.tenantId).toBe(tenantId);
  });

  it("hash uyuşmazlığında transaction içinde create çağrılmadan reddeder", async () => {
    const { tx, ecuFileCreate } = createFakeTx();
    const { prisma } = createFakePrisma(tx);
    const storage = createMockStorage("actual-hash");

    await expect(
      confirmEcuFileUploadTransactional(
        prisma,
        tenantId,
        storage,
        baseParams({ claimedChecksum: "claimed-hash" }),
      ),
    ).rejects.toBeInstanceOf(ChecksumMismatchError);
    expect(ecuFileCreate).not.toHaveBeenCalled();
  });

  it("create() DB'nin unique index'ine (P2002) çarparsa — eşzamanlı ikinci yükleme — DuplicateEcuFileError'a çevirir", async () => {
    const { tx, ecuFileCreate } = createFakeTx();
    ecuFileCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.0.0",
      }),
    );
    const existingLookup = vi.fn().mockResolvedValue({ id: "existing-file-id" });
    const { prisma } = createFakePrisma(tx, existingLookup);
    const storage = createMockStorage("verified-hash");

    await expect(
      confirmEcuFileUploadTransactional(prisma, tenantId, storage, baseParams()),
    ).rejects.toBeInstanceOf(DuplicateEcuFileError);
    expect(existingLookup).toHaveBeenCalledWith({
      where: { tenantId, vehicleId, checksum: "verified-hash" },
    });
  });

  it("P2002 dışındaki bir hatayı olduğu gibi yeniden fırlatır", async () => {
    const { tx, ecuFileCreate } = createFakeTx();
    const genericError = new Error("beklenmeyen DB hatası");
    ecuFileCreate.mockRejectedValue(genericError);
    const { prisma } = createFakePrisma(tx);
    const storage = createMockStorage("verified-hash");

    await expect(
      confirmEcuFileUploadTransactional(prisma, tenantId, storage, baseParams()),
    ).rejects.toBe(genericError);
  });
});
