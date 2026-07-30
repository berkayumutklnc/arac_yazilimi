import type { Prisma } from "../../generated/prisma/client.js";
import type { DealerAccountStatus } from "../../generated/prisma/enums.js";

// fileRequestFulfillmentTransactional.ts'den çıkarıldı (saf ekstraksiyon,
// davranış değişmedi) — dealerCreditTopupTransactional.ts da AYNI ham SQL'i
// kullanır, iki ayrı kopya raw SQL sürüklenme riski taşırdı. SELECT listesi
// dealerCreditTopup için hubTenantId/dealerTenantId/status'u da içerecek
// şekilde genişletildi — fulfillFileRequest bu ek alanları yoksayar
// (yalnızca id/creditBalanceKurus okur), geriye dönük uyumlu.
//
// Prisma'nın `FOR UPDATE` için birinci sınıf bir API'si yok; kilitli okuma
// ham SQL ile yazılıyor — aynı `tx` üzerinden, template literal parametrize
// edildiği için SQL injection riski yok.
export interface DealerAccountLockRow {
  id: string;
  hubTenantId: string;
  dealerTenantId: string;
  status: DealerAccountStatus;
  creditBalanceKurus: number;
}

export async function lockDealerAccountForUpdate(
  tx: Prisma.TransactionClient,
  dealerAccountId: string,
): Promise<DealerAccountLockRow | null> {
  const rows = await tx.$queryRaw<DealerAccountLockRow[]>`
    SELECT "id", "hubTenantId", "dealerTenantId", "status", "creditBalanceKurus"
    FROM "DealerAccount" WHERE "id" = ${dealerAccountId} FOR UPDATE
  `;
  return rows[0] ?? null;
}
