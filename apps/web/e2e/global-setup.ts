import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Kayıt/seed HTTP endpoint'i yok (bkz. apps/api ADR 0006 "Kapsam Dışı") —
// e2e fixture'ları apps/api/scripts/seedE2e.ts ile doğrudan Prisma üzerinden
// yazılır (DATABASE_URL_TEST hedefler, uygulama DB'sine dokunmaz). Bu,
// gerçek bir PostgreSQL bağlantısı gerektirir — bkz. docs/local-postgres-setup.md.
export default function globalSetup(): void {
  const apiDir = path.resolve(__dirname, "../../api");
  execSync("npm run seed:e2e", { cwd: apiDir, stdio: "inherit" });
}
