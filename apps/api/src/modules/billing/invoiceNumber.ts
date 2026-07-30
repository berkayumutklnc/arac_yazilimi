import type { Prisma } from "../../generated/prisma/client.js";

// bkz. ADR 0014. "{yıl}-{6 haneli sıfır dolgulu sıra}" — ör. 2026-000001.
export function formatInvoiceNumber(year: number, seq: number): string {
  return `${year}-${String(seq).padStart(6, "0")}`;
}

// ADR 0007'nin DealerAccount kilitleme deseniyle AYNI: INSERT..ON CONFLICT DO
// NOTHING (satırı garanti et) + SELECT..FOR UPDATE (kilitle) + UPDATE (artır),
// hepsi çağıranın $transaction'ı içinde — tenant+yıl başına atlamasız,
// eşzamanlılık-güvenli sıra numarası (bkz. invoiceTransactional.ts).
export async function allocateInvoiceNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  year: number,
): Promise<number> {
  await tx.$executeRaw`
    INSERT INTO "InvoiceCounter" ("tenantId", "year", "lastNumber")
    VALUES (${tenantId}, ${year}, 0)
    ON CONFLICT ("tenantId", "year") DO NOTHING
  `;

  const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
    SELECT "lastNumber" FROM "InvoiceCounter"
    WHERE "tenantId" = ${tenantId} AND "year" = ${year}
    FOR UPDATE
  `;

  const nextNumber = (rows[0]?.lastNumber ?? 0) + 1;

  await tx.$executeRaw`
    UPDATE "InvoiceCounter" SET "lastNumber" = ${nextNumber}
    WHERE "tenantId" = ${tenantId} AND "year" = ${year}
  `;

  return nextNumber;
}
