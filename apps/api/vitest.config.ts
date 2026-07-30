import { defineConfig } from "vitest/config";

// Varsayılan `npm test` yalnızca fake/mock tabanlı birim testlerini çalıştırır.
// Gerçek PostgreSQL gerektiren entegrasyon testleri (*.integration.test.ts)
// burada bilinçli olarak HARİÇ tutulur — bkz. vitest.integration.config.ts,
// `npm run test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    exclude: ["**/node_modules/**", "**/*.integration.test.ts"],
  },
});
