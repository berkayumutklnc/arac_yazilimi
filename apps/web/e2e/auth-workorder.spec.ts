import { test, expect, type Page } from "@playwright/test";
import { E2E_FIXTURES } from "./fixtures.js";

async function login(page: Page, tenantSlug: string, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Atölye (tenant)").fill(tenantSlug);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(E2E_FIXTURES.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL(/\/work-orders$/);
}

test("login → iş emri oluştur → durum ilerlet", async ({ page }) => {
  await login(page, E2E_FIXTURES.hubTenantSlug, E2E_FIXTURES.hubOwnerEmail);

  await page.getByRole("link", { name: "Yeni İş Emri" }).click();
  await expect(page).toHaveURL(/\/work-orders\/new$/);
  await page.getByLabel("Araç ID").fill(E2E_FIXTURES.vehicleId);
  await page.getByRole("button", { name: "Oluştur" }).click();

  await expect(page).toHaveURL(/\/work-orders\/[^/]+$/);

  // DRAFT -> ACCEPTED (reason gerekmez)
  await page.getByRole("button", { name: "Kabul Edildi" }).click();
  await expect(page.getByRole("button", { name: "Üretimde" })).toBeVisible();

  // ACCEPTED -> IN_PROGRESS (reason gerekmez)
  await page.getByRole("button", { name: "Üretimde" }).click();
  await expect(page.getByRole("button", { name: "Parça Bekleniyor" })).toBeVisible();

  // Yalnızca geçerli geçişler görünür — DRAFT/ACCEPTED'a geri dönüş butonu olmamalı.
  await expect(page.getByRole("button", { name: "Taslak" })).toHaveCount(0);
});
