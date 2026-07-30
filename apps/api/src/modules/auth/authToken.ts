import { createHash, randomBytes } from "node:crypto";
import { createSigner, createVerifier } from "fast-jwt";
import { Role } from "../../generated/prisma/enums.js";

export interface AccessTokenPayload {
  userId: string;
  tenantId: string;
  role: Role;
}

const VALID_ROLES: ReadonlySet<string> = new Set(Object.values(Role));

export class InvalidAccessTokenError extends Error {
  constructor(cause?: unknown) {
    super("Access token geçersiz veya süresi dolmuş.");
    this.name = "InvalidAccessTokenError";
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000; // 15 dakika
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 gün

export function signAccessToken(payload: AccessTokenPayload, secret: string): string {
  const signer = createSigner({ key: secret, expiresIn: ACCESS_TOKEN_TTL_MS });
  return signer(payload);
}

function isAccessTokenPayload(value: unknown): value is AccessTokenPayload {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.userId === "string" &&
    typeof record.tenantId === "string" &&
    typeof record.role === "string" &&
    VALID_ROLES.has(record.role)
  );
}

export function verifyAccessToken(token: string, secret: string): AccessTokenPayload {
  const verifier = createVerifier({ key: secret });
  let decoded: unknown;
  try {
    decoded = verifier(token);
  } catch (err) {
    throw new InvalidAccessTokenError(err);
  }

  if (!isAccessTokenPayload(decoded)) {
    throw new InvalidAccessTokenError();
  }

  return { userId: decoded.userId, tenantId: decoded.tenantId, role: decoded.role };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface GeneratedRefreshToken {
  token: string;
  tokenHash: string;
  expiresAt: Date;
}

export function generateRefreshToken(): GeneratedRefreshToken {
  const token = randomBytes(32).toString("hex");
  return {
    token,
    tokenHash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  };
}
