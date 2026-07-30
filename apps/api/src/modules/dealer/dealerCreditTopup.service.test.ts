import { describe, expect, it, vi } from "vitest";
import {
  topUpDealerCredit,
  DealerAccountNotActiveError,
  type DealerCreditTopupDb,
} from "./dealerCreditTopup.service.js";
import { ForbiddenDealerLinkActionError, DealerLinkNotFoundError, type ActingUser } from "./dealerLink.service.js";
import { Role } from "../../generated/prisma/enums.js";

const hubTenantId = "hub-1";
const dealerAccountId = "acct-1";
const hubOwner: ActingUser = { id: "hub-owner-1", tenantId: hubTenantId, role: Role.OWNER };

function createMockDb() {
  const findUnique = vi.fn<DealerCreditTopupDb["dealerAccount"]["findUnique"]>();
  const update = vi.fn<DealerCreditTopupDb["dealerAccount"]["update"]>();
  const create = vi.fn<DealerCreditTopupDb["dealerCreditTransaction"]["create"]>();
  const db: DealerCreditTopupDb = {
    dealerAccount: { findUnique, update },
    dealerCreditTransaction: { create },
  };
  return { db, findUnique, update, create };
}

function accountRow(overrides: Record<string, unknown> = {}) {
  return {
    id: dealerAccountId,
    hubTenantId,
    dealerTenantId: "dealer-1",
    status: "ACTIVE" as const,
    creditBalanceKurus: 10_000,
    ...overrides,
  };
}

describe("topUpDealerCredit", () => {
  it("OWNER olmayan bir rol ForbiddenDealerLinkActionError alır", async () => {
    const { db } = createMockDb();
    const engineer: ActingUser = { id: "eng-1", tenantId: hubTenantId, role: Role.ENGINEER };

    await expect(topUpDealerCredit(db, engineer, dealerAccountId, 5000)).rejects.toBeInstanceOf(
      ForbiddenDealerLinkActionError,
    );
  });

  it("dealer OWNER'ı (hub tarafı olmayan) kendi hesabına top-up yapamaz — DealerLinkNotFoundError", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(accountRow());
    const dealerOwner: ActingUser = { id: "dealer-owner-1", tenantId: "dealer-1", role: Role.OWNER };

    await expect(topUpDealerCredit(db, dealerOwner, dealerAccountId, 5000)).rejects.toBeInstanceOf(
      DealerLinkNotFoundError,
    );
  });

  it("var olmayan bir hesap için DealerLinkNotFoundError fırlatır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(topUpDealerCredit(db, hubOwner, dealerAccountId, 5000)).rejects.toBeInstanceOf(
      DealerLinkNotFoundError,
    );
  });

  it("henüz ACTIVE olmayan (PENDING/REJECTED) bir hesaba top-up yapılamaz", async () => {
    const { db, findUnique, update } = createMockDb();
    findUnique.mockResolvedValue(accountRow({ status: "PENDING" }));

    await expect(topUpDealerCredit(db, hubOwner, dealerAccountId, 5000)).rejects.toBeInstanceOf(
      DealerAccountNotActiveError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("geçerli top-up: bakiyeyi artırır, pozitif amountKurus ile DealerCreditTransaction oluşturur", async () => {
    const { db, findUnique, update, create } = createMockDb();
    findUnique.mockResolvedValue(accountRow());

    const result = await topUpDealerCredit(db, hubOwner, dealerAccountId, 5000);

    expect(result).toEqual({ balanceAfterKurus: 15_000 });
    expect(update).toHaveBeenCalledWith({ where: { id: dealerAccountId }, data: { creditBalanceKurus: 15_000 } });
    expect(create).toHaveBeenCalledWith({
      data: { dealerAccountId, amountKurus: 5000, balanceAfterKurus: 15_000, fileRequestId: null },
    });
  });
});
