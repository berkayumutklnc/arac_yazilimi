import { describe, expect, it, vi } from "vitest";
import { ensurePlatformTenant, PLATFORM_TENANT_SLUG, PLATFORM_TENANT_NAME } from "./platformTenant.js";

describe("ensurePlatformTenant", () => {
  it("sabit slug ile idempotent bir upsert çağırır", async () => {
    const upsert = vi.fn().mockResolvedValue({ id: "platform-tenant-1" });

    const result = await ensurePlatformTenant({ tenant: { upsert } });

    expect(upsert).toHaveBeenCalledWith({
      where: { slug: PLATFORM_TENANT_SLUG },
      create: { name: PLATFORM_TENANT_NAME, slug: PLATFORM_TENANT_SLUG },
      update: {},
    });
    expect(result).toEqual({ id: "platform-tenant-1" });
  });
});
