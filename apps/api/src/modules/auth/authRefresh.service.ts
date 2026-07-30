import type { Role } from "../../generated/prisma/enums.js";
import { generateRefreshToken, hashRefreshToken, signAccessToken } from "./authToken.js";
import { revokeAllRefreshTokensForUser } from "./refreshTokenRevocation.js";

export class InvalidRefreshTokenError extends Error {
  constructor() {
    super("Refresh token geçersiz, süresi dolmuş veya iptal edilmiş.");
    this.name = "InvalidRefreshTokenError";
  }
}

interface RefreshTokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

interface UserRecord {
  id: string;
  tenantId: string;
  role: Role;
}

export interface AuthRefreshDb {
  refreshToken: {
    findUnique: (args: { where: { tokenHash: string } }) => Promise<RefreshTokenRecord | null>;
    update: (args: {
      where: { id: string };
      data: { revokedAt: Date; replacedById?: string };
    }) => Promise<unknown>;
    create: (args: {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    }) => Promise<{ id: string }>;
    updateMany: (args: {
      where: { userId: string; revokedAt: null };
      data: { revokedAt: Date };
    }) => Promise<unknown>;
  };
  user: {
    findUnique: (args: { where: { id: string } }) => Promise<UserRecord | null>;
  };
}

export interface RefreshResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export async function refreshTokens(
  db: AuthRefreshDb,
  jwtSecret: string,
  presentedToken: string,
): Promise<RefreshResult> {
  const tokenHash = hashRefreshToken(presentedToken);
  const record = await db.refreshToken.findUnique({ where: { tokenHash } });
  if (!record) {
    throw new InvalidRefreshTokenError();
  }

  if (record.revokedAt !== null) {
    // Çalıntı token belirtisi (reuse detection): daha önce rotasyonla devre
    // dışı bırakılmış bir token tekrar sunuluyor — kullanıcının tüm aktif
    // refresh token'ları iptal edilir.
    await revokeAllRefreshTokensForUser(db, record.userId);
    throw new InvalidRefreshTokenError();
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw new InvalidRefreshTokenError();
  }

  const user = await db.user.findUnique({ where: { id: record.userId } });
  if (!user) {
    throw new InvalidRefreshTokenError();
  }

  const newRefresh = generateRefreshToken();
  const created = await db.refreshToken.create({
    data: { userId: user.id, tokenHash: newRefresh.tokenHash, expiresAt: newRefresh.expiresAt },
  });
  await db.refreshToken.update({
    where: { id: record.id },
    data: { revokedAt: new Date(), replacedById: created.id },
  });

  const accessToken = signAccessToken(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    jwtSecret,
  );

  return {
    accessToken,
    refreshToken: newRefresh.token,
    refreshTokenExpiresAt: newRefresh.expiresAt,
  };
}
