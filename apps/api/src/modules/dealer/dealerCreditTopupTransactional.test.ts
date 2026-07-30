import { describe, expect, it, vi } from "vitest";
import { topUpDealerCreditTransactional } from "./dealerCreditTopupTransactional.js";
import { DealerAccountNotActiveError } from "./dealerCreditTopup.service.js";
import { Role } from "../../generated/prisma/enums.js";
import type { ActingUser } from "./dealerLink.service.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

const hubTenantId = "hub-1";
const dealerAccountId = "acct-1";
const hubOwner: ActingUser = { id: "hub-owner-1", tenantId: hubTenantId, role: Role.OWNER };

function createFakeTx(overrides: { lockRow?: Record<string, unknown> | null } = {}) {
  const queryRaw = vi.fn().mockResolvedValue(
    overrides.lockRow === undefined
      ? [{ id: dealerAccountId, hubTenantId, dealerTenantId: "dealer-1", status: "ACTIVE", creditBalanceKurus: 10_000 }]
      : overrides.lockRow === null
        ? []
        : [overrides.lockRow],
  );
  const dealerAccountUpdate = vi.fn().mockResolvedValue({});
  const dealerCreditTransactionCreate = vi.fn().mockResolvedValue({});

  const tx = {
    $queryRaw: queryRaw,
    dealerAccount: { update: dealerAccountUpdate },
    dealerCreditTransaction: { create: dealerCreditTransactionCreate },
  };

  return { tx, queryRaw, dealerAccountUpdate, dealerCreditTransactionCreate };
}

function createFakePrisma(tx: unknown) {
  const $transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(tx));
  const prisma = { $transaction } as unknown as PrismaClient;
  return { prisma, $transaction };
}

describe("topUpDealerCreditTransactional", () => {
  it("prisma.$transaction içinde tek bir işlem olarak çalışır", async () => {
    const { tx } = createFakeTx();
    const { prisma, $transaction } = createFakePrisma(tx);

    await topUpDealerCreditTransactional(prisma, hubOwner, dealerAccountId, 5000);

    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("dealerAccount bakiyesi FOR UPDATE ile kilitli satır sorgusuyla okunur", async () => {
    const { tx, queryRaw } = createFakeTx();
    const { prisma } = createFakePrisma(tx);

    await topUpDealerCreditTransactional(prisma, hubOwner, dealerAccountId, 5000);

    expect(queryRaw).toHaveBeenCalledTimes(1);
    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain("FOR UPDATE");
    expect(values).toContain(dealerAccountId);
  });

  it("bakiyeyi doğru şekilde artırır", async () => {
    const { tx, dealerAccountUpdate, dealerCreditTransactionCreate } = createFakeTx();
    const { prisma } = createFakePrisma(tx);

    const result = await topUpDealerCreditTransactional(prisma, hubOwner, dealerAccountId, 5000);

    expect(result).toEqual({ balanceAfterKurus: 15_000 });
    expect(dealerAccountUpdate).toHaveBeenCalledWith({
      where: { id: dealerAccountId },
      data: { creditBalanceKurus: 15_000 },
    });
    expect(dealerCreditTransactionCreate).toHaveBeenCalledWith({
      data: { dealerAccountId, amountKurus: 5000, balanceAfterKurus: 15_000, fileRequestId: null },
    });
  });

  it("kilitli okumada status ACTIVE değilse DealerAccountNotActiveError fırlatır, bakiye güncellenmez", async () => {
    const { tx, dealerAccountUpdate } = createFakeTx({
      lockRow: { id: dealerAccountId, hubTenantId, dealerTenantId: "dealer-1", status: "PENDING", creditBalanceKurus: 10_000 },
    });
    const { prisma } = createFakePrisma(tx);

    await expect(
      topUpDealerCreditTransactional(prisma, hubOwner, dealerAccountId, 5000),
    ).rejects.toBeInstanceOf(DealerAccountNotActiveError);
    expect(dealerAccountUpdate).not.toHaveBeenCalled();
  });
});
