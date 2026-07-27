import { test, expect } from "@playwright/test";

test("ana sayfa yükleniyor", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/./);
});
