// Playwright e2e testleri (apps/web/e2e) için sabit, deterministik fixture
// verisi. Kayıt/seed HTTP endpoint'i kasıtlı olarak yok (bkz. ADR 0006
// "Kapsam Dışı") — bu yüzden doğrudan Prisma ile yazılıyor. DATABASE_URL_TEST
// hedeflenir (apps/api/src/testUtils/integrationDb.ts reuse edilir),
// uygulama veritabanına (DATABASE_URL) ASLA dokunmaz. Çalıştırma:
// `npm run seed:e2e` (apps/api) — kurulum: docs/local-postgres-setup.md.
import "dotenv/config";
import { hashPassword } from "../src/modules/auth/authPassword.js";
import { EcuFileType, Role } from "../src/generated/prisma/enums.js";
import { createTestPrismaClient, resetTestDatabase } from "../src/testUtils/integrationDb.js";
import { PLATFORM_TENANT_SLUG, PLATFORM_TENANT_NAME } from "../src/modules/admin/platformTenant.js";

// apps/web/e2e/*.spec.ts ile senkron tutulmalı (ayrı paket olduğu için
// aynı sabitler orada da tanımlı).
export const E2E_FIXTURES = {
  hubTenantId: "e2e-hub-tenant",
  hubTenantSlug: "e2e-hub",
  hubOwnerEmail: "owner@e2e-hub.test",
  dealerTenantId: "e2e-dealer-tenant",
  dealerTenantSlug: "e2e-dealer",
  dealerUserEmail: "dealer@e2e-dealer.test",
  password: "E2eTestSifre_2026!",
  vehicleId: "e2e-vehicle-1",
  stockEcuFileId: "e2e-stock-1",
  dealerAccountId: "e2e-dealer-account-1",
  // Admin/davet akışlarının (ADR 0010/0011) e2e kapsamı için.
  platformTenantId: "e2e-platform-tenant",
  superAdminEmail: "admin@e2e-platform.test",
} as const;

async function seed() {
  const prisma = createTestPrismaClient();
  await resetTestDatabase(prisma);

  const passwordHash = await hashPassword(E2E_FIXTURES.password);

  const hubTenant = await prisma.tenant.create({
    data: { id: E2E_FIXTURES.hubTenantId, name: "E2E Hub Atölye", slug: E2E_FIXTURES.hubTenantSlug },
  });
  const dealerTenant = await prisma.tenant.create({
    data: {
      id: E2E_FIXTURES.dealerTenantId,
      name: "E2E Dealer Atölye",
      slug: E2E_FIXTURES.dealerTenantSlug,
    },
  });

  await prisma.user.create({
    data: { tenantId: hubTenant.id, email: E2E_FIXTURES.hubOwnerEmail, passwordHash, role: Role.OWNER },
  });
  await prisma.user.create({
    data: { tenantId: dealerTenant.id, email: E2E_FIXTURES.dealerUserEmail, passwordHash, role: Role.DEALER },
  });

  const customer = await prisma.customer.create({
    data: { tenantId: hubTenant.id, fullName: "E2E Test Müşteri", phoneHash: "e2e-seed-phone-hash" },
  });
  const vehicle = await prisma.vehicle.create({
    data: {
      id: E2E_FIXTURES.vehicleId,
      tenantId: hubTenant.id,
      customerId: customer.id,
      plate: "34E2E34",
      brand: "Test",
      model: "Model",
      year: 2024,
    },
  });

  // NOT: storageKey gerçek MinIO'da yok — bu satır yalnızca readFileId/
  // stockRomRef referansı olarak kullanılmak için var, indirme akışının
  // KENDİSİ testte gerçekten YÜKLENEN bir dosya üzerinden doğrulanıyor.
  await prisma.ecuFile.create({
    data: {
      id: E2E_FIXTURES.stockEcuFileId,
      tenantId: hubTenant.id,
      vehicleId: vehicle.id,
      fileType: EcuFileType.ORIGINAL_STOCK,
      storageKey: "e2e-seed/stock.bin",
      checksum: "e2e-seed-stock-checksum",
      uploadedBy: "seed-script",
      stockRomRef: E2E_FIXTURES.stockEcuFileId,
    },
  });

  const hubOwner = await prisma.user.findUniqueOrThrow({
    where: { tenantId_email: { tenantId: hubTenant.id, email: E2E_FIXTURES.hubOwnerEmail } },
  });
  const dealerUser = await prisma.user.findUniqueOrThrow({
    where: { tenantId_email: { tenantId: dealerTenant.id, email: E2E_FIXTURES.dealerUserEmail } },
  });

  // Zaten ACTIVE — bağlama akışının (ADR 0013) KENDİSİ ayrı bir e2e senaryosu
  // olarak test edilir, bu fixture'daki hesap dosya-talebi/kredi akışları
  // için hazır kullanılabilir olmalı.
  await prisma.dealerAccount.create({
    data: {
      id: E2E_FIXTURES.dealerAccountId,
      hubTenantId: hubTenant.id,
      dealerTenantId: dealerTenant.id,
      status: "ACTIVE",
      requestedBy: hubOwner.id,
      approvedBy: dealerUser.id,
      respondedAt: new Date(),
      creditBalanceKurus: 100_000,
    },
  });

  // Platform-admin/davet akışlarının (ADR 0010/0011) e2e kapsamı için —
  // bootstrapPlatformAdmin.ts'nin gerçek DB'deki eşdeğeri, yalnızca test DB'sinde.
  const platformTenant = await prisma.tenant.create({
    data: { id: E2E_FIXTURES.platformTenantId, name: PLATFORM_TENANT_NAME, slug: PLATFORM_TENANT_SLUG },
  });
  await prisma.user.create({
    data: {
      tenantId: platformTenant.id,
      email: E2E_FIXTURES.superAdminEmail,
      passwordHash,
      role: Role.SUPER_ADMIN,
    },
  });

  console.log("E2E fixture verisi yazıldı:", E2E_FIXTURES);
  await prisma.$disconnect();
}

seed().catch((err: unknown) => {
  console.error("E2E seed başarısız:", err);
  process.exit(1);
});
