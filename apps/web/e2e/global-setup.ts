import { execSync } from "node:child_process";
import path from "node:path";

// Playwright bu dosyayı CommonJS olarak derleyip çalıştırıyor (apps/web'in
// package.json'ında "type": "module" yok) — __dirname zaten CJS modül
// sarmalayıcısının native global'i, ESM'deki import.meta.url şiması burada
// hem gereksiz hem de "Cannot use 'import.meta' outside a module" hatasına
// yol açıyordu (canlı Postgres'e karşı ilk gerçek e2e çalıştırmasında
// tespit edildi).
//
// Kayıt/seed HTTP endpoint'i yok (bkz. apps/api ADR 0006 "Kapsam Dışı") —
// e2e fixture'ları apps/api/scripts/seedE2e.ts ile doğrudan Prisma üzerinden
// yazılır (DATABASE_URL_TEST hedefler, uygulama DB'sine dokunmaz). Bu,
// gerçek bir PostgreSQL bağlantısı gerektirir — bkz. docs/local-postgres-setup.md.
export default function globalSetup(): void {
  const apiDir = path.resolve(__dirname, "../../api");
  execSync("npm run seed:e2e", { cwd: apiDir, stdio: "inherit" });
}
