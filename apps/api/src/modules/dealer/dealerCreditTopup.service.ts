import { Role, type DealerAccountStatus } from "../../generated/prisma/enums.js";
import { ForbiddenDealerLinkActionError, DealerLinkNotFoundError, type ActingUser } from "./dealerLink.service.js";

export class DealerAccountNotActiveError extends Error {
  constructor(dealerAccountId: string) {
    super(`Bayi hesabı henüz aktif değil (bağlantı onaylanmamış): ${dealerAccountId}`);
    this.name = "DealerAccountNotActiveError";
  }
}

interface DealerAccountBalanceRecord {
  id: string;
  hubTenantId: string;
  dealerTenantId: string;
  status: DealerAccountStatus;
  creditBalanceKurus: number;
}

// bkz. docs/adr/0013-dealer-account-linking-status.md. ADR 0007'nin FOR
// UPDATE kilitleme stratejisinin yeni bir çağrıcısı — dealerCreditTransaction
// fileRequestId: null taşır (bu bir talep karşılama değil, doğrudan yükleme).
export interface DealerCreditTopupDb {
  dealerAccount: {
    findUnique: (args: { where: { id: string } }) => Promise<DealerAccountBalanceRecord | null>;
    update: (args: {
      where: { id: string };
      data: { creditBalanceKurus: number };
    }) => Promise<unknown>;
  };
  dealerCreditTransaction: {
    create: (args: {
      data: {
        dealerAccountId: string;
        amountKurus: number;
        balanceAfterKurus: number;
        fileRequestId: null;
      };
    }) => Promise<unknown>;
  };
}

export interface TopUpDealerCreditResult {
  balanceAfterKurus: number;
}

// Kullanıcının açık isteği gereği yalnızca hub OWNER — fileRequest.service.ts
// akışlarındaki HUB_ROLES=[OWNER,ENGINEER]'den bilinçli olarak daha dar.
export async function topUpDealerCredit(
  db: DealerCreditTopupDb,
  actingUser: ActingUser,
  dealerAccountId: string,
  amountKurus: number,
): Promise<TopUpDealerCreditResult> {
  if (actingUser.role !== Role.OWNER) {
    throw new ForbiddenDealerLinkActionError();
  }

  const account = await db.dealerAccount.findUnique({ where: { id: dealerAccountId } });
  if (!account || account.hubTenantId !== actingUser.tenantId) {
    throw new DealerLinkNotFoundError(dealerAccountId);
  }
  if (account.status !== "ACTIVE") {
    throw new DealerAccountNotActiveError(dealerAccountId);
  }

  const balanceAfterKurus = account.creditBalanceKurus + amountKurus;
  await db.dealerAccount.update({ where: { id: account.id }, data: { creditBalanceKurus: balanceAfterKurus } });
  await db.dealerCreditTransaction.create({
    data: { dealerAccountId: account.id, amountKurus, balanceAfterKurus, fileRequestId: null },
  });

  return { balanceAfterKurus };
}
