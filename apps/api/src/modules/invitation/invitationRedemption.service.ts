import type { Role } from "../../generated/prisma/enums.js";
import { hashPassword } from "../auth/authPassword.js";
import { hashInvitationToken } from "./invitationToken.js";

// Yok/süresi dolmuş/kabul edilmiş/iptal edilmiş — hepsi TEK bir generic
// hataya indirgeniyor (bkz. ADR 0011, InvalidRefreshTokenError/
// InvalidCredentialsError deseni) — enumeration direnci.
export class InvalidInvitationTokenError extends Error {
  constructor() {
    super("Davet linki geçersiz, süresi dolmuş veya zaten kullanılmış.");
    this.name = "InvalidInvitationTokenError";
  }
}

interface InvitationLookupRecord {
  id: string;
  tenantId: string;
  email: string;
  role: Role;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
}

export interface InvitationRedemptionDb {
  invitation: {
    findUnique: (args: { where: { tokenHash: string } }) => Promise<InvitationLookupRecord | null>;
    updateMany: (args: {
      where: { id: string; acceptedAt: null };
      data: { acceptedAt: Date };
    }) => Promise<{ count: number }>;
  };
  user: {
    create: (args: {
      data: { tenantId: string; email: string; passwordHash: string; role: Role };
    }) => Promise<{ id: string }>;
  };
}

export interface InvitationPreview {
  tenantId: string;
  email: string;
  role: Role;
}

async function lookupValidInvitation(
  db: Pick<InvitationRedemptionDb, "invitation">,
  token: string,
): Promise<InvitationLookupRecord> {
  const tokenHash = hashInvitationToken(token);
  const record = await db.invitation.findUnique({ where: { tokenHash } });
  if (!record || record.revokedAt !== null || record.acceptedAt !== null) {
    throw new InvalidInvitationTokenError();
  }
  if (record.expiresAt.getTime() < Date.now()) {
    throw new InvalidInvitationTokenError();
  }
  return record;
}

export async function previewInvitation(
  db: Pick<InvitationRedemptionDb, "invitation">,
  token: string,
): Promise<InvitationPreview> {
  const record = await lookupValidInvitation(db, token);
  return { tenantId: record.tenantId, email: record.email, role: record.role };
}

export interface RedeemInvitationResult {
  userId: string;
}

export async function redeemInvitation(
  db: InvitationRedemptionDb,
  token: string,
  newPassword: string,
): Promise<RedeemInvitationResult> {
  const record = await lookupValidInvitation(db, token);

  // Tek-kullanımlık: yalnızca acceptedAt hâlâ null iken işaretlenebilir —
  // eşzamanlı iki redemption'dan yalnızca biri 1 satır etkiler (ADR 0007'nin
  // count-guard deseni).
  const marked = await db.invitation.updateMany({
    where: { id: record.id, acceptedAt: null },
    data: { acceptedAt: new Date() },
  });
  if (marked.count === 0) {
    throw new InvalidInvitationTokenError();
  }

  const passwordHash = await hashPassword(newPassword);
  const user = await db.user.create({
    data: { tenantId: record.tenantId, email: record.email, passwordHash, role: record.role },
  });

  return { userId: user.id };
}
