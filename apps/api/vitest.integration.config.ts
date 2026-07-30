import { defineConfig } from "vitest/config";

// Gerçek bir PostgreSQL 16'ya (DATABASE_URL_TEST) bağlanan entegrasyon
// testleri — fake/mock YOK. Ayrı bir dosya deseni ve ayrı bir npm script
// (`npm run test:integration`) ile normal `npm test`'ten tamamen izole:
// DB yoksa/erişilemezse normal birim test çalıştırması hiç etkilenmez.
// Kurulum: docs/local-postgres-setup.md.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["./vitest.integration.setup.ts"],
    passWithNoTests: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
    // Eşzamanlılık testleri kasıtlı olarak paylaşılan satır kilitlerine
    // dayanıyor — dosyaların birbirini engellememesi için sıralı çalıştır.
    fileParallelism: false,
  },
});
