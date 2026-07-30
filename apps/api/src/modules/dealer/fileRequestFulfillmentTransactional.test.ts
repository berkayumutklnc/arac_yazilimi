import { describe, expect, it, vi } from "vitest";
import {
  fulfillFileRequestTransactional,
  ConcurrentFulfillmentError,
} from "./fileRequestFulfillmentTransactional.js";
import { InsufficientCreditError } from "./fileRequestFulfillment.service.js";
import { Role, EcuFileType } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

// Bu dosya prisma.$transaction'ın gerçek bir DB'ye değil, ADAPTÖRÜN kendi
// mantığına (FOR UPDATE sorgusu, status-korumalı updateMany, dealer-tenant
// scoping) doğru bağlandığını fake bir `tx` ile doğrular — gerçek eşzamanlı
// kilitlenme davranışı yalnızca entegrasyon testinde (gerçek Postgres,
// docs/local-postgres-setup.md) doğrulanabilir.

const hubTenantId = "hub-1";
const dealerTenantId = "dealer-1";
const fileRequestId = "req-1";
const dealerAccountId = "acct-1";
const vehicleId = "vehicle-1";
const readFileId = "read-file-1";
const hubEngineer = { id: "hub-engineer-1", tenantId: hubTenantId, role: Role.ENGINEER };

function fileRequestRow(overrides: Record<string, unknown> = {}) {
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

function createFakeTx(overrides: { dealerAccountRow?: Record<string, unknown> | null } = {}) {
  const queryRaw = vi.fn().mockResolvedValue(
    overrides.dealerAccountRow === undefined
      ? [{ id: dealerAccountId, creditBalanceKurus: 20000 }]
      : overrides.dealerAccountRow === null
        ? []
        : [overrides.dealerAccountRow],
  );
  const fileRequestFindUnique = vi.fn().mockResolvedValue(fileRequestRow());
  const fileRequestUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const dealerAccountUpdate = vi.fn().mockResolvedValue({});
  const dealerCreditTransactionCreate = vi.fn().mockResolvedValue({});
  const auditCreate = vi.fn().mockResolvedValue({});
  const vehicleFindUnique = vi.fn().mockResolvedValue({ id: vehicleId });
  const ecuFileFindUnique = vi.fn().mockResolvedValue({
    id: readFileId,
    vehicleId,
    fileType: EcuFileType.ORIGINAL_STOCK,
  });
  const ecuFileCreate = vi.fn().mockResolvedValue({ id: "result-file-1" });

  const tx = {
    $queryRaw: queryRaw,
    fileRequest: { findUnique: fileRequestFindUnique, updateMany: fileRequestUpdateMany },
    dealerAccount: { update: dealerAccountUpdate },
    dealerCreditTransaction: { create: dealerCreditTransactionCreate },
    fileRequestStatusAuditLog: { create: auditCreate },
    vehicle: { findUnique: vehicleFindUnique },
    ecuFile: { create: ecuFileCreate, findUnique: ecuFileFindUnique },
  };

  return {
    tx,
    queryRaw,
    fileRequestFindUnique,
    fileRequestUpdateMany,
    dealerAccountUpdate,
    dealerCreditTransactionCreate,
    auditCreate,
    vehicleFindUnique,
    ecuFileCreate,
    ecuFileFindUnique,
  };
}

function createFakePrisma(tx: unknown) {
  const $transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(tx));
  const prisma = { $transaction } as unknown as PrismaClient;
  return { prisma, $transaction };
}

function baseParams() {
  return {
    fileRequestId,
    hubTenantId,
    actingUser: hubEngineer,
    storageKey: "s3://calibrated/stage1.bin",
    checksum: "checksum-abc",
  };
}

describe("fulfillFileRequestTransactional", () => {
  it("prisma.$transaction içinde tek bir işlem olarak çalışır", async () => {
    const { tx } = createFakeTx();
    const { prisma, $transaction } = createFakePrisma(tx);

    await fulfillFileRequestTransactional(prisma, baseParams());

    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("dealerAccount bakiyesi FOR UPDATE ile kilitli satır sorgusuyla okunur", async () => {
    const { tx, queryRaw } = createFakeTx();
    const { prisma } = createFakePrisma(tx);

    await fulfillFileRequestTransactional(prisma, baseParams());

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain("FOR UPDATE");
    expect(values).toContain(dealerAccountId);
  });

  it("fileRequest güncellemesi yalnızca status=IN_PROGRESS koşuluyla korunan updateMany kullanır", async () => {
    const { tx, fileRequestUpdateMany } = createFakeTx();
    const { prisma } = createFakePrisma(tx);

    await fulfillFileRequestTransactional(prisma, baseParams());

    expect(fileRequestUpdateMany).toHaveBeenCalledWith({
      where: { id: fileRequestId, status: "IN_PROGRESS" },
      data: { status: "FULFILLED", resultFileId: "result-file-1", processedBy: hubEngineer.id },
    });
  });

  it("eşzamanlı bir işlem talebi zaten sonuçlandırmışsa (updateMany 0 satır etkiler) ConcurrentFulfillmentError fırlatır", async () => {
    const { tx, fileRequestUpdateMany } = createFakeTx();
    fileRequestUpdateMany.mockResolvedValue({ count: 0 });
    const { prisma } = createFakePrisma(tx);

    await expect(fulfillFileRequestTransactional(prisma, baseParams())).rejects.toBeInstanceOf(
      ConcurrentFulfillmentError,
    );
  });

  it("kilitli okumada bakiye yetersizse InsufficientCreditError fırlatır, dosya/kredi/durum güncellemesi yapılmaz", async () => {
    const { tx, ecuFileCreate, dealerAccountUpdate, fileRequestUpdateMany } = createFakeTx({
      dealerAccountRow: { id: dealerAccountId, creditBalanceKurus: 4999 },
    });
    const { prisma } = createFakePrisma(tx);

    await expect(fulfillFileRequestTransactional(prisma, baseParams())).rejects.toBeInstanceOf(
      InsufficientCreditError,
    );
    expect(ecuFileCreate).not.toHaveBeenCalled();
    expect(dealerAccountUpdate).not.toHaveBeenCalled();
    expect(fileRequestUpdateMany).not.toHaveBeenCalled();
  });

  it("kalibre dosya, dealer tenant'ına scoped çağrılarla oluşturulur (vehicle/ecuFile sorgularına dealerTenantId enjekte edilir)", async () => {
    const { tx, vehicleFindUnique, ecuFileCreate } = createFakeTx();
    const { prisma } = createFakePrisma(tx);

    await fulfillFileRequestTransactional(prisma, baseParams());

    expect(vehicleFindUnique).toHaveBeenCalledWith({ where: { id: vehicleId, tenantId: dealerTenantId } });
    const createArgs = ecuFileCreate.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(createArgs.data.tenantId).toBe(dealerTenantId);
  });
});
