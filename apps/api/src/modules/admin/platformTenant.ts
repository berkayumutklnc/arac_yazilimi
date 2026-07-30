// bkz. ADR 0010. SUPER_ADMIN kullanıcıları bu sabit slug'lı placeholder
// Tenant'a bağlanır — User.tenantId NOT NULL kalır, yeni bir kolon/ayrım
// eklenmez.
export const PLATFORM_TENANT_SLUG = "__platform__";
export const PLATFORM_TENANT_NAME = "Platform Yönetimi";

export interface PlatformTenantDb {
  tenant: {
    upsert: (args: {
      where: { slug: string };
      create: { name: string; slug: string };
      update: Record<string, never>;
    }) => Promise<{ id: string }>;
  };
}

// Deploy-time bootstrap script tarafından çağrılır (idempotent — zaten
// varsa dokunmaz, `update: {}`).
export async function ensurePlatformTenant(db: Pick<PlatformTenantDb, "tenant">): Promise<{ id: string }> {
  return db.tenant.upsert({
    where: { slug: PLATFORM_TENANT_SLUG },
    create: { name: PLATFORM_TENANT_NAME, slug: PLATFORM_TENANT_SLUG },
    update: {},
  });
}
