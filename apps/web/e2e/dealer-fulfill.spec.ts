import { test, expect, type Browser, type Page } from "@playwright/test";
import { E2E_FIXTURES } from "./fixtures.js";

async function login(page: Page, tenantSlug: string, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Atölye (tenant)").fill(tenantSlug);
  await page.getByLabel("E-posta").fill(email);
  await page.getByLabel("Şifre").fill(E2E_FIXTURES.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL(/\/work-orders$/);
}

async function newPageForUser(browser: Browser, tenantSlug: string, email: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await login(page, tenantSlug, email);
  return page;
}

test("dealer talep açar, hub kabul edip fulfill eder", async ({ browser }) => {
  const dealerPage = await newPageForUser(browser, E2E_FIXTURES.dealerTenantSlug, E2E_FIXTURES.dealerUserEmail);
  const hubPage = await newPageForUser(browser, E2E_FIXTURES.hubTenantSlug, E2E_FIXTURES.hubOwnerEmail);

  await dealerPage.goto("/dealer");
  // hubTenantId hem bakiye sorgusu hem talep formunda AYNI state'e bağlı
  // (bkz. apps/web/app/(protected)/dealer/page.tsx) — birini doldurmak yeter.
  await dealerPage.getByLabel("Merkez (hub) Tenant ID").first().fill(E2E_FIXTURES.hubTenantId);
  await dealerPage.getByLabel("Araç ID").fill(E2E_FIXTURES.vehicleId);
  await dealerPage.getByLabel("Orijinal Dosya (readFileId)").fill(E2E_FIXTURES.stockEcuFileId);
  await dealerPage.getByRole("button", { name: "Talebi Gönder" }).click();
  await expect(dealerPage.getByText("PENDING").first()).toBeVisible();

  await hubPage.goto("/dealer");
  await hubPage.getByRole("button", { name: "Kabul Et" }).click();
  await hubPage.getByLabel("Ücret (TL)").fill("50");
  await hubPage.getByRole("button", { name: "Onayla" }).click();
  await expect(hubPage.getByText("ACCEPTED").first()).toBeVisible();

  await hubPage.getByRole("button", { name: "Üretime Al" }).click();
  await expect(hubPage.getByText("IN_PROGRESS").first()).toBeVisible();

  const fileChooserPromise = hubPage.waitForEvent("filechooser");
  await hubPage.getByRole("button", { name: /Kalibre Dosyayı Yükle/ }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "e2e-stage1.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("e2e stage1 calibration content"),
  });

  await expect(hubPage.getByText("FULFILLED").first()).toBeVisible();
});
