import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import { topUpDealerCredit, type DealerCreditTopupDb, type TopUpDealerCreditResult } from "./dealerCreditTopup.service.js";
import { lockDealerAccountForUpdate } from "./dealerAccountLock.js";
import type { ActingUser } from "./dealerLink.service.js";

// bkz. docs/adr/0007-credit-deduction-locking-strategy.md,
// docs/adr/0013-dealer-account-linking-status.md. topUpDealerCredit'in saf,
// fake ile test edilmiş mantığını DEĞİŞTİRMEZ; yalnızca prisma.$transaction
// üzerinde çalışan, dealerAccountLock.ts'deki PAYLAŞILAN FOR UPDATE
// sorgusunu kullanan ÜRETİM adaptörünü sağlar.
function buildTransactionalDb(tx: Prisma.TransactionClient): DealerCreditTopupDb {
  return {
    dealerAccount: {
      findUnique: (args) => lockDealerAccountForUpdate(tx, args.where.id),
      update: (args) => tx.dealerAccount.update(args),
    },
    dealerCreditTransaction: {
      create: (args) => tx.dealerCreditTransaction.create(args),
    },
  };
}

export async function topUpDealerCreditTransactional(
  prisma: PrismaClient,
  actingUser: ActingUser,
  dealerAccountId: string,
  amountKurus: number,
): Promise<TopUpDealerCreditResult> {
  return prisma.$transaction(async (tx) => {
    const db = buildTransactionalDb(tx);
    return topUpDealerCredit(db, actingUser, dealerAccountId, amountKurus);
  });
}
