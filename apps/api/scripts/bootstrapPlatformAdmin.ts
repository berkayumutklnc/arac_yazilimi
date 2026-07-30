// İlk SUPER_ADMIN'i deploy-time'da oluşturur (bkz. docs/adr/0010-super-admin-platform-tenant.md).
// Kayıt/davet HTTP endpoint'leriyle ÇÖZÜLEMEYECEK bir chicken-and-egg problemi
// çözer: bir SUPER_ADMIN yaratmak için zaten bir SUPER_ADMIN gerekirdi. Bu
// script GERÇEK uygulama veritabanını (DATABASE_URL) hedefler — seedE2e.ts'nin
// aksine test DB'sini değil. İdempotent: SUPER_ADMIN zaten varsa hiçbir şey
// yapmaz, güvenle tekrar çalıştırılabilir. Çalıştırma: `npm run
// bootstrap:platform-admin` (apps/api) — PLATFORM_ADMIN_EMAIL/
// PLATFORM_ADMIN_INITIAL_PASSWORD env değişkenlerini gerektirir.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { hashPassword } from "../src/modules/auth/authPassword.js";
import { Role } from "../src/generated/prisma/enums.js";
import { ensurePlatformTenant, PLATFORM_TENANT_SLUG } from "../src/modules/admin/platformTenant.js";

async function bootstrap() {
  const email = process.env.PLATFORM_ADMIN_EMAIL;
  const initialPassword = process.env.PLATFORM_ADMIN_INITIAL_PASSWORD;
  if (!email || !initialPassword) {
    throw new Error(
      "PLATFORM_ADMIN_EMAIL ve PLATFORM_ADMIN_INITIAL_PASSWORD ortam değişkenleri zorunlu — bkz. apps/api/.env.example.",
    );
  }

  const prisma = new PrismaClient();
  const platformTenant = await ensurePlatformTenant(prisma);

  const existingSuperAdmin = await prisma.user.findFirst({
    where: { tenantId: platformTenant.id, role: Role.SUPER_ADMIN },
  });
  if (existingSuperAdmin) {
    console.log(`Zaten bir SUPER_ADMIN var (${existingSuperAdmin.email}) — idempotent, hiçbir şey yapılmadı.`);
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await hashPassword(initialPassword);
  const superAdmin = await prisma.user.create({
    data: { tenantId: platformTenant.id, email, passwordHash, role: Role.SUPER_ADMIN },
  });

  console.log(
    `İlk SUPER_ADMIN oluşturuldu: ${superAdmin.email} — giriş için tenantSlug="${PLATFORM_TENANT_SLUG}" kullanın.`,
  );
  await prisma.$disconnect();
}

bootstrap().catch((err: unknown) => {
  console.error("Platform admin bootstrap başarısız:", err);
  process.exit(1);
});
