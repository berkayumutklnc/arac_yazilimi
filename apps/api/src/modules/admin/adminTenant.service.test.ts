import { describe, expect, it, vi } from "vitest";
import {
  createTenantWithFirstInvitation,
  listTenants,
  TenantSlugAlreadyExistsError,
  type AdminTenantDb,
} from "./adminTenant.service.js";
import { PLATFORM_TENANT_SLUG } from "./platformTenant.js";
import { Role } from "../../generated/prisma/enums.js";
import type { EmailSender } from "../../notifications/emailSender.js";

function createMockDb() {
  const tenantFindUnique = vi.fn<AdminTenantDb["tenant"]["findUnique"]>();
  const tenantCreate = vi.fn<AdminTenantDb["tenant"]["create"]>();
  const tenantFindMany = vi.fn<AdminTenantDb["tenant"]["findMany"]>();
  const invitationCreate = vi.fn<AdminTenantDb["invitation"]["create"]>();
  const db: AdminTenantDb = {
    tenant: { findUnique: tenantFindUnique, create: tenantCreate, findMany: tenantFindMany },
    invitation: { create: invitationCreate },
  };
  return { db, tenantFindUnique, tenantCreate, tenantFindMany, invitationCreate };
}

function createMockEmailSender() {
  const sendInvitationEmail = vi.fn<EmailSender["sendInvitationEmail"]>().mockResolvedValue(undefined);
  const emailSender: EmailSender = { sendInvitationEmail };
  return { emailSender, sendInvitationEmail };
}

const baseParams = {
  name: "Acme Atölye",
  slug: "acme",
  ownerEmail: "owner@acme.test",
  createdBy: "super-admin-1",
};

describe("createTenantWithFirstInvitation", () => {
  it("slug zaten kullanılıyorsa TenantSlugAlreadyExistsError fırlatır, tenant/davet oluşturulmaz", async () => {
    const { db, tenantFindUnique, tenantCreate } = createMockDb();
    const { emailSender } = createMockEmailSender();
    tenantFindUnique.mockResolvedValue({ id: "existing-tenant" });

    await expect(
      createTenantWithFirstInvitation(
        { db, emailSender, webAppBaseUrl: "https://app.example.test" },
        baseParams,
      ),
    ).rejects.toBeInstanceOf(TenantSlugAlreadyExistsError);
    expect(tenantCreate).not.toHaveBeenCalled();
  });

  it("yeni tenant + ilk OWNER daveti oluşturur, davet e-postası gönderir", async () => {
    const { db, tenantFindUnique, tenantCreate, invitationCreate } = createMockDb();
    const { emailSender, sendInvitationEmail } = createMockEmailSender();
    tenantFindUnique.mockResolvedValue(null);
    tenantCreate.mockResolvedValue({ id: "tenant-1", name: baseParams.name, slug: baseParams.slug });
    invitationCreate.mockResolvedValue({
      id: "inv-1",
      tenantId: "tenant-1",
      email: baseParams.ownerEmail,
      role: Role.OWNER,
      tokenHash: "irrelevant",
      invitedBy: baseParams.createdBy,
      expiresAt: new Date(Date.now() + 1000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    });

    const result = await createTenantWithFirstInvitation(
      { db, emailSender, webAppBaseUrl: "https://app.example.test" },
      baseParams,
    );

    expect(tenantCreate).toHaveBeenCalledWith({ data: { name: baseParams.name, slug: baseParams.slug } });
    const invitationArgs = invitationCreate.mock.calls[0]?.[0];
    expect(invitationArgs?.data.tenantId).toBe("tenant-1");
    expect(invitationArgs?.data.role).toBe(Role.OWNER);
    expect(invitationArgs?.data.invitedBy).toBe(baseParams.createdBy);
    expect(result.tenant.id).toBe("tenant-1");
    expect(result.rawToken).toHaveLength(64);

    expect(sendInvitationEmail).toHaveBeenCalledTimes(1);
    const emailArgs = sendInvitationEmail.mock.calls[0]?.[0];
    expect(emailArgs?.toEmail).toBe(baseParams.ownerEmail);
    expect(emailArgs?.redeemUrl).toContain("https://app.example.test");
    expect(emailArgs?.redeemUrl).toContain(result.rawToken);
  });

  it("e-posta gönderimi başarısız olsa bile tenant/davet oluşturulmuş sonucu döner (best-effort)", async () => {
    const { db, tenantFindUnique, tenantCreate, invitationCreate } = createMockDb();
    const { emailSender, sendInvitationEmail } = createMockEmailSender();
    tenantFindUnique.mockResolvedValue(null);
    tenantCreate.mockResolvedValue({ id: "tenant-1", name: baseParams.name, slug: baseParams.slug });
    invitationCreate.mockResolvedValue({
      id: "inv-1",
      tenantId: "tenant-1",
      email: baseParams.ownerEmail,
      role: Role.OWNER,
      tokenHash: "irrelevant",
      invitedBy: baseParams.createdBy,
      expiresAt: new Date(Date.now() + 1000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    });
    sendInvitationEmail.mockRejectedValue(new Error("smtp kapalı"));

    const result = await createTenantWithFirstInvitation(
      { db, emailSender, webAppBaseUrl: "https://app.example.test" },
      baseParams,
    );

    expect(result.tenant.id).toBe("tenant-1");
  });
});

describe("listTenants", () => {
  it("platform tenant'ı hariç tutarak listeler", async () => {
    const { db, tenantFindMany } = createMockDb();
    tenantFindMany.mockResolvedValue([]);

    await listTenants(db);

    expect(tenantFindMany).toHaveBeenCalledWith({
      where: { slug: { not: PLATFORM_TENANT_SLUG } },
      orderBy: { createdAt: "desc" },
    });
  });
});
