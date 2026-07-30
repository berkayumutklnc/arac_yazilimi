import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  // Kritik e2e senaryoları (bkz. e2e/*.spec.ts) sabit fixture verisine
  // ihtiyaç duyar — gerçek bir PostgreSQL/MinIO gerektirir, bu ajan
  // oturumunda çalıştırılamadı (bkz. docs/local-postgres-setup.md,
  // docs/local-minio-setup.md). Kurulum tamamlanınca `npm run test:e2e`.
  globalSetup: "./e2e/global-setup.ts",
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: true,
  },
  use: {
    baseURL: "http://localhost:3000",
  },
});
