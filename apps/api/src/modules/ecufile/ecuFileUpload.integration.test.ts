import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrismaClient, resetTestDatabase } from "../../testUtils/integrationDb.js";
import { confirmEcuFileUploadTransactional } from "./ecuFileUploadTransactional.js";
import { DuplicateEcuFileError } from "./ecuFileUpload.service.js";
import { EcuFileType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

// Gerçek PostgreSQL 16'ya bağlanır (DATABASE_URL_TEST). Amaç: EcuFile(tenantId,
// vehicleId, checksum) unique index'inin (bkz. schema.prisma, ADR 0007),
// findFirst+create check-then-act deseninin tek başına yakalayamadığı
// eşzamanlı-mükerrer-yükleme yarışını gerçekten engellediğini kanıtlamak.

const prisma: PrismaClient = createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
});

async function seedVehicleWithStockRom(tenantId: string) {
  const tenant = await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, name: "Test Tenant", slug: `tenant-${randomUUID()}` },
  });
  const customer = await prisma.customer.create({
    data: { tenantId: tenant.id, fullName: "Test Müşteri", phoneHash: "hash" },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      tenantId: tenant.id,
      customerId: customer.id,
      plate: "34DUP34",
      brand: "Test",
      model: "Model",
      year: 2020,
    },
  });
  const stockRomId = randomUUID();
  const stockRom = await prisma.ecuFile.create({
    data: {
      id: stockRomId,
      tenantId: tenant.id,
      vehicleId: vehicle.id,
      fileType: EcuFileType.ORIGINAL_STOCK,
      storageKey: "stock.bin",
      checksum: "stock-hash",
      uploadedBy: "seed",
      stockRomRef: stockRomId,
    },
  });
  return { tenant, vehicle, stockRom };
}

describe("confirmEcuFileUploadTransactional — eşzamanlılık (gerçek PostgreSQL)", () => {
  it("aynı araç+hash için eşzamanlı iki yükleme — yalnızca biri kaydedilir, diğeri DuplicateEcuFileError alır", async () => {
    const tenantId = randomUUID();
    const { vehicle, stockRom } = await seedVehicleWithStockRom(tenantId);
    const sameChecksum = "identical-hash";
    const storage = { readObjectSha256: () => Promise.resolve(sameChecksum) };

    const [resultA, resultB] = await Promise.allSettled([
      confirmEcuFileUploadTransactional(prisma, tenantId, storage, {
        vehicleId: vehicle.id,
        fileType: EcuFileType.STAGE1,
        storageKey: "tenant/vehicle/a.bin",
        claimedChecksum: sameChecksum,
        uploadedBy: "user-a",
        stockRomRef: stockRom.id,
      }),
      confirmEcuFileUploadTransactional(prisma, tenantId, storage, {
        vehicleId: vehicle.id,
        fileType: EcuFileType.STAGE1,
        storageKey: "tenant/vehicle/b.bin",
        claimedChecksum: sameChecksum,
        uploadedBy: "user-b",
        stockRomRef: stockRom.id,
      }),
    ]);

    const results = [resultA, resultB];
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((r) => r.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(DuplicateEcuFileError);

    const stage1Files = await prisma.ecuFile.findMany({
      where: { vehicleId: vehicle.id, checksum: sameChecksum },
    });
    expect(stage1Files).toHaveLength(1);
  });
});
