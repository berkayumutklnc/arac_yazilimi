import { PrismaClient } from "../generated/prisma/client.js";

// Entegrasyon testleri (npm run test:integration) yalnızca DATABASE_URL_TEST
// hedefler — uygulama veritabanına (DATABASE_URL) ASLA dokunmaz. Değişken
// tanımlı değilse test hemen ve açık bir hatayla durur (bkz.
// docs/local-postgres-setup.md); sessizce uygulama DB'sine düşmek riskli
// olurdu.
export function createTestPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error(
      "DATABASE_URL_TEST tanımlı değil. Entegrasyon testleri ayrı bir test veritabanına " +
        "ihtiyaç duyar (bkz. docs/local-postgres-setup.md) — uygulama veritabanına karşı " +
        "çalıştırılmamalı.",
    );
  }
  return new PrismaClient({ datasourceUrl: url });
}

const TABLES_IN_FK_SAFE_ORDER = [
  "FileRequestStatusAuditLog",
  "DealerCreditTransaction",
  "FileRequest",
  "DealerAccount",
  "EcuFileDownloadAuditLog",
  "EcuFile",
  "WorkOrderComplianceStep",
  "WorkOrderStatusAuditLog",
  "WorkOrderItem",
  "InvoiceLine",
  "Payment",
  "Invoice",
  "WorkOrder",
  "Vehicle",
  "Customer",
  "RefreshToken",
  "User",
  "Tenant",
  "ServiceType",
] as const;

export async function resetTestDatabase(prisma: PrismaClient): Promise<void> {
  const quoted = TABLES_IN_FK_SAFE_ORDER.map((name) => `"${name}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);
}
