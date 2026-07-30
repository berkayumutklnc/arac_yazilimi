// apps/api/scripts/seedE2e.ts (E2E_FIXTURES) ile senkron tutulmalı — ayrı
// paket olduğu için (apps/api vs apps/web) aynı sabitler burada da tanımlı.
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
} as const;
