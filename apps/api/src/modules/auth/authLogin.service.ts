import type { Role } from "../../generated/prisma/enums.js";
import { verifyPassword } from "./authPassword.js";
import { generateRefreshToken, signAccessToken } from "./authToken.js";

export class InvalidCredentialsError extends Error {
  constructor() {
    // Hangi alanın (tenant/email/şifre) yanlış olduğu kasıtlı olarak
    // belirtilmiyor — kullanıcı/tenant numaralandırmayı önler.
    super("Geçersiz atölye kimliği, e-posta veya şifre.");
    this.name = "InvalidCredentialsError";
  }
}

interface TenantRecord {
  id: string;
}

interface UserRecord {
  id: string;
  tenantId: string;
  passwordHash: string;
  role: Role;
}

export interface AuthLoginDb {
  tenant: {
    findUnique: (args: { where: { slug: string } }) => Promise<TenantRecord | null>;
  };
  user: {
    findUnique: (args: {
      where: { tenantId_email: { tenantId: string; email: string } };
    }) => Promise<UserRecord | null>;
  };
  refreshToken: {
    create: (args: {
      data: { userId: string; tokenHash: string; expiresAt: Date };
    }) => Promise<unknown>;
  };
}

export interface LoginInput {
  tenantSlug: string;
  email: string;
  password: string;
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
}

export async function login(
  db: AuthLoginDb,
  jwtSecret: string,
  input: LoginInput,
): Promise<LoginResult> {
  const tenant = await db.tenant.findUnique({ where: { slug: input.tenantSlug } });
  if (!tenant) {
    throw new InvalidCredentialsError();
  }

  const user = await db.user.findUnique({
    where: { tenantId_email: { tenantId: tenant.id, email: input.email } },
  });
  if (!user) {
    throw new InvalidCredentialsError();
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) {
    throw new InvalidCredentialsError();
  }

  const accessToken = signAccessToken(
    { userId: user.id, tenantId: user.tenantId, role: user.role },
    jwtSecret,
  );
  const refresh = generateRefreshToken();
  await db.refreshToken.create({
    data: { userId: user.id, tokenHash: refresh.tokenHash, expiresAt: refresh.expiresAt },
  });

  return {
    accessToken,
    refreshToken: refresh.token,
    refreshTokenExpiresAt: refresh.expiresAt,
  };
}
