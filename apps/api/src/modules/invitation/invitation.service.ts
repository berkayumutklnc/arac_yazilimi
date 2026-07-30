import type { Role } from "../../generated/prisma/enums.js";
import { generateInvitationToken } from "./invitationToken.js";

export interface InvitationRecord {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  tokenHash: string;
  invitedBy: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}

// tenantId create data'sında AÇIKÇA taşınır (dealer modülünün iki-tenant
// modelleri gibi ham prisma ile de, tenant-scoped `request.tenantDb.invitation`
// ile de çalışsın diye — extension eşleşen bir tenantId'yi kabul eder, bkz.
// tenantScopedDb.ts::applyTenantScope). Bu, SUPER_ADMIN'in yeni-tenant-için-
// ilk-daveti (ham prisma) ile OWNER'ın kendi tenant'ına daveti
// (request.tenantDb) AYNI fonksiyonu kullanabilsin diye bilinçli bir tercih.
// create/findMany ayrı arayüzlerde — yalnızca oluşturması gereken çağıranları
// (ör. adminTenant.service.ts) findMany implemente etmeye zorlamamak için.
export interface InvitationCreateDb {
  invitation: {
    create: (args: {
      data: {
        tenantId: string;
        email: string;
        role: Role;
        tokenHash: string;
        invitedBy: string;
        expiresAt: Date;
      };
    }) => Promise<InvitationRecord>;
  };
}

export interface InvitationListDb {
  invitation: {
    findMany: (args: {
      where: { tenantId: string };
      orderBy: { createdAt: "desc" };
    }) => Promise<InvitationRecord[]>;
  };
}

export type InvitationDb = InvitationCreateDb & InvitationListDb;

export interface CreateInvitationParams {
  tenantId: string;
  email: string;
  role: Role;
  invitedBy: string;
}

export interface CreateInvitationResult {
  invitation: InvitationRecord;
  rawToken: string;
}

export async function createInvitation(
  db: InvitationCreateDb,
  params: CreateInvitationParams,
): Promise<CreateInvitationResult> {
  const { token, tokenHash, expiresAt } = generateInvitationToken();
  const invitation = await db.invitation.create({
    data: {
      tenantId: params.tenantId,
      email: params.email,
      role: params.role,
      tokenHash,
      invitedBy: params.invitedBy,
      expiresAt,
    },
  });
  return { invitation, rawToken: token };
}

export async function listInvitations(db: InvitationListDb, tenantId: string): Promise<InvitationRecord[]> {
  return db.invitation.findMany({
    where: { tenantId },
    orderBy: { createdAt: "desc" },
  });
}
