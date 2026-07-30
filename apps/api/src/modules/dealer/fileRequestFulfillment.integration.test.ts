import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createTestPrismaClient, resetTestDatabase } from "../../testUtils/integrationDb.js";
import { fulfillFileRequestTransactional } from "./fileRequestFulfillmentTransactional.js";
import { InsufficientCreditError } from "./fileRequestFulfillment.service.js";
import { Role, EcuFileType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

// Bu test GERÇEK bir PostgreSQL 16'ya bağlanır (DATABASE_URL_TEST) — fake/mock
// yok. Amaç: fulfillFileRequestTransactional'ın SELECT...FOR UPDATE kilidinin
// (bkz. docs/adr/0007) eşzamanlı iki çağrı altında gerçekten serileştirdiğini
// kanıtlamak. Kurulum: docs/local-postgres-setup.md.

const prisma: PrismaClient = createTestPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

beforeEach(async () => {
  await resetTestDatabase(prisma);
});

async function seedHubDealerScenario(costKurus: number, creditBalanceKurus: number) {
  const hubTenant = await prisma.tenant.create({
    data: { name: "Hub", slug: `hub-${randomUUID()}` },
  });
  const dealerTenant = await prisma.tenant.create({
    data: { name: "Dealer", slug: `dealer-${randomUUID()}` },
  });
  const customer = await prisma.customer.create({
    data: { tenantId: dealerTenant.id, fullName: "Test Müşteri", phoneHash: "hash" },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      tenantId: dealerTenant.id,
      customerId: customer.id,
      plate: "34TEST34",
      brand: "Test",
      model: "Model",
      year: 2020,
    },
  });
  const stockRomId = randomUUID();
  const stockRom = await prisma.ecuFile.create({
    data: {
      id: stockRomId,
      tenantId: dealerTenant.id,
      vehicleId: vehicle.id,
      fileType: EcuFileType.ORIGINAL_STOCK,
      storageKey: "stock.bin",
      checksum: "stock-hash",
      uploadedBy: "seed",
      stockRomRef: stockRomId,
    },
  });

  const dealerAccount = await prisma.dealerAccount.create({
    data: { hubTenantId: hubTenant.id, dealerTenantId: dealerTenant.id, creditBalanceKurus },
  });

  const hubEngineer = { id: randomUUID(), tenantId: hubTenant.id, role: Role.ENGINEER };

  const makeFileRequest = () =>
    prisma.fileRequest.create({
      data: {
        hubTenantId: hubTenant.id,
        dealerTenantId: dealerTenant.id,
        dealerAccountId: dealerAccount.id,
        vehicleId: vehicle.id,
        readFileId: stockRom.id,
        requestedStage: EcuFileType.STAGE1,
        status: "IN_PROGRESS",
        costKurus,
        requestedBy: "dealer-user",
      },
    });

  const [fileRequestA, fileRequestB] = await Promise.all([makeFileRequest(), makeFileRequest()]);

  return { hubTenant, dealerTenant, dealerAccount, hubEngineer, fileRequestA, fileRequestB };
}

describe("fulfillFileRequestTransactional — eşzamanlılık (gerçek PostgreSQL)", () => {
  it(
    "aynı dealerAccount için eşzamanlı iki fulfill çağrısı — bakiye yalnızca birini " +
      "karşılıyorsa yalnızca biri başarılı olur, bakiye asla negatife düşmez",
    async () => {
      const costKurus = 5000;
      const { dealerAccount, hubEngineer, fileRequestA, fileRequestB, hubTenant } =
        await seedHubDealerScenario(costKurus, costKurus);

      const [resultA, resultB] = await Promise.allSettled([
        fulfillFileRequestTransactional(prisma, {
          fileRequestId: fileRequestA.id,
          hubTenantId: hubTenant.id,
          actingUser: hubEngineer,
          storageKey: "s3://calibrated/a.bin",
          checksum: "checksum-a",
        }),
        fulfillFileRequestTransactional(prisma, {
          fileRequestId: fileRequestB.id,
          hubTenantId: hubTenant.id,
          actingUser: hubEngineer,
          storageKey: "s3://calibrated/b.bin",
          checksum: "checksum-b",
        }),
      ]);

      const results = [resultA, resultB];
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientCreditError);

      const finalAccount = await prisma.dealerAccount.findUniqueOrThrow({
        where: { id: dealerAccount.id },
      });
      expect(finalAccount.creditBalanceKurus).toBe(0);
      expect(finalAccount.creditBalanceKurus).toBeGreaterThanOrEqual(0);

      const requests = await prisma.fileRequest.findMany({
        where: { id: { in: [fileRequestA.id, fileRequestB.id] } },
      });
      expect(requests.filter((r) => r.status === "FULFILLED")).toHaveLength(1);
      expect(requests.filter((r) => r.status === "IN_PROGRESS")).toHaveLength(1);

      const transactions = await prisma.dealerCreditTransaction.findMany({
        where: { dealerAccountId: dealerAccount.id },
      });
      expect(transactions).toHaveLength(1);
    },
  );

  it(
    "bakiye her iki maliyeti de karşılıyorsa iki farklı talep bağımsız şekilde " +
      "başarılı olur ve toplam düşüş doğru hesaplanır",
    async () => {
      const costKurus = 5000;
      const { dealerAccount, hubEngineer, fileRequestA, fileRequestB, hubTenant } =
        await seedHubDealerScenario(costKurus, costKurus * 2);

      const results = await Promise.allSettled([
        fulfillFileRequestTransactional(prisma, {
          fileRequestId: fileRequestA.id,
          hubTenantId: hubTenant.id,
          actingUser: hubEngineer,
          storageKey: "s3://calibrated/a.bin",
          checksum: "checksum-a",
        }),
        fulfillFileRequestTransactional(prisma, {
          fileRequestId: fileRequestB.id,
          hubTenantId: hubTenant.id,
          actingUser: hubEngineer,
          storageKey: "s3://calibrated/b.bin",
          checksum: "checksum-b",
        }),
      ]);

      expect(results.every((r) => r.status === "fulfilled")).toBe(true);
      const finalAccount = await prisma.dealerAccount.findUniqueOrThrow({
        where: { id: dealerAccount.id },
      });
      expect(finalAccount.creditBalanceKurus).toBe(0);
    },
  );
});
