import { test, expect } from "@playwright/test";
import { E2E_FIXTURES } from "./fixtures.js";

test("dosya yükle → indir", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Atölye (tenant)").fill(E2E_FIXTURES.hubTenantSlug);
  await page.getByLabel("E-posta").fill(E2E_FIXTURES.hubOwnerEmail);
  await page.getByLabel("Şifre").fill(E2E_FIXTURES.password);
  await page.getByRole("button", { name: "Giriş Yap" }).click();
  await expect(page).toHaveURL(/\/work-orders$/);

  await page.goto(`/vehicles/${E2E_FIXTURES.vehicleId}`);

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Dosya Yükle" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "e2e-test-calibration.bin",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("e2e test ecu calibration content"),
  });

  // upload-request → PUT (MinIO) → upload-confirm zinciri tamamlanınca yeni
  // dosya ağaçta görünür (bkz. apps/web/lib/sha256.ts, ecuFileUploadTransactional.ts).
  await expect(page.getByText("ORIGINAL_STOCK").first()).toBeVisible();

  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "İndir" }).first().click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/.+/);
});
