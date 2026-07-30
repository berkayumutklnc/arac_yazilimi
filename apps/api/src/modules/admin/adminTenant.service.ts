import { Role } from "../../generated/prisma/enums.js";
import {
  createInvitation,
  type InvitationCreateDb,
  type InvitationRecord,
} from "../invitation/invitation.service.js";
import type { EmailSender } from "../../notifications/emailSender.js";
import { PLATFORM_TENANT_SLUG } from "./platformTenant.js";

export class TenantSlugAlreadyExistsError extends Error {
  constructor(slug: string) {
    super(`Bu slug zaten kullanılıyor: ${slug}`);
    this.name = "TenantSlugAlreadyExistsError";
  }
}

interface TenantRecord {
  id: string;
  name: string;
  slug: string;
}

interface TenantWithCreatedAt extends TenantRecord {
  createdAt: Date;
}

export interface AdminTenantDb extends InvitationCreateDb {
  tenant: {
    findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null>;
    create: (args: { data: { name: string; slug: string } }) => Promise<TenantRecord>;
    findMany: (args: {
      where: { slug: { not: string } };
      orderBy: { createdAt: "desc" };
    }) => Promise<TenantWithCreatedAt[]>;
  };
}

export interface CreateTenantParams {
  name: string;
  slug: string;
  ownerEmail: string;
  createdBy: string;
}

export interface CreateTenantWithFirstInvitationDeps {
  db: AdminTenantDb;
  emailSender: EmailSender;
  webAppBaseUrl: string;
}

export interface CreateTenantWithFirstInvitationResult {
  tenant: TenantRecord;
  invitation: InvitationRecord;
  rawToken: string;
}

export async function createTenantWithFirstInvitation(
  deps: CreateTenantWithFirstInvitationDeps,
  params: CreateTenantParams,
): Promise<CreateTenantWithFirstInvitationResult> {
  const existing = await deps.db.tenant.findUnique({ where: { slug: params.slug } });
  if (existing) {
    throw new TenantSlugAlreadyExistsError(params.slug);
  }

  const tenant = await deps.db.tenant.create({ data: { name: params.name, slug: params.slug } });

  const { invitation, rawToken } = await createInvitation(deps.db, {
    tenantId: tenant.id,
    email: params.ownerEmail,
    role: Role.OWNER,
    invitedBy: params.createdBy,
  });

  // Best-effort: e-posta gönderimi başarısız olsa bile tenant/davet zaten
  // oluşturuldu — işlem geri alınmaz (SUPER_ADMIN, davet listesinden linki
  // her zaman tekrar görebilir/paylaşabilir).
  try {
    const redeemUrl = new URL(`/invite/accept?token=${rawToken}`, deps.webAppBaseUrl).toString();
    await deps.emailSender.sendInvitationEmail({
      toEmail: params.ownerEmail,
      tenantName: tenant.name,
      role: Role.OWNER,
      redeemUrl,
      expiresAt: invitation.expiresAt,
    });
  } catch (err) {
    console.error(`Davet e-postası gönderilemedi (tenant=${tenant.id}):`, err);
  }

  return { tenant, invitation, rawToken };
}

// Platform tenant'ının kendisi bir "atölye" değil — listeden hariç tutulur.
export async function listTenants(db: Pick<AdminTenantDb, "tenant">): Promise<TenantWithCreatedAt[]> {
  return db.tenant.findMany({
    where: { slug: { not: PLATFORM_TENANT_SLUG } },
    orderBy: { createdAt: "desc" },
  });
}
