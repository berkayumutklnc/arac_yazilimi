import { createHash, randomBytes } from "node:crypto";

// RefreshToken'daki ham-token/SHA-256-hash deseninin tekrarı (bkz. ADR 0011,
// apps/api/src/modules/auth/authToken.ts::generateRefreshToken/hashRefreshToken)
// — kasıtlı olarak ayrı tutuldu (ayrı bir güvenlik ilkesi, ayrı bir dosya).
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface GeneratedInvitationToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function generateInvitationToken(): GeneratedInvitationToken {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashInvitationToken(token),
    expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
  };
}
