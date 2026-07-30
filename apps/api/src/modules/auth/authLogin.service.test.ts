import { describe, expect, it, vi } from "vitest";
import { login, InvalidCredentialsError, type AuthLoginDb } from "./authLogin.service.js";
import { verifyAccessToken } from "./authToken.js";
import { hashPassword } from "./authPassword.js";
import { Role } from "../../generated/prisma/enums.js";

const jwtSecret = "test-secret";
const tenantSlug = "acme-workshop";
const email = "owner@acme.test";
const password = "correct-horse-battery-staple";

function createMockDb() {
  const tenantFindUnique = vi.fn<AuthLoginDb["tenant"]["findUnique"]>();
  const userFindUnique = vi.fn<AuthLoginDb["user"]["findUnique"]>();
  const refreshTokenCreate = vi.fn<AuthLoginDb["refreshToken"]["create"]>();
  const db: AuthLoginDb = {
    tenant: { findUnique: tenantFindUnique },
    user: { findUnique: userFindUnique },
    refreshToken: { create: refreshTokenCreate },
  };
  return { db, tenantFindUnique, userFindUnique, refreshTokenCreate };
}

describe("login", () => {
  it("bilinmeyen tenantSlug için InvalidCredentialsError fırlatır, kullanıcı hiç aranmaz", async () => {
    const { db, tenantFindUnique, userFindUnique } = createMockDb();
    tenantFindUnique.mockResolvedValue(null);

    await expect(
      login(db, jwtSecret, { tenantSlug, email, password }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(userFindUnique).not.toHaveBeenCalled();
  });

  it("bilinmeyen e-posta için InvalidCredentialsError fırlatır", async () => {
    const { db, tenantFindUnique, userFindUnique } = createMockDb();
    tenantFindUnique.mockResolvedValue({ id: "tenant-1" });
    userFindUnique.mockResolvedValue(null);

    await expect(
      login(db, jwtSecret, { tenantSlug, email, password }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it("yanlış şifre için InvalidCredentialsError fırlatır, refresh token oluşturulmaz", async () => {
    const { db, tenantFindUnique, userFindUnique, refreshTokenCreate } = createMockDb();
    tenantFindUnique.mockResolvedValue({ id: "tenant-1" });
    userFindUnique.mockResolvedValue({
      id: "user-1",
      tenantId: "tenant-1",
      passwordHash: await hashPassword(password),
      role: Role.OWNER,
      deactivatedAt: null,
    });

    await expect(
      login(db, jwtSecret, { tenantSlug, email, password: "wrong-password" }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(refreshTokenCreate).not.toHaveBeenCalled();
  });

  it("deaktive edilmiş kullanıcı için InvalidCredentialsError fırlatır (aynı generic mesaj — enumeration direnci)", async () => {
    const { db, tenantFindUnique, userFindUnique, refreshTokenCreate } = createMockDb();
    tenantFindUnique.mockResolvedValue({ id: "tenant-1" });
    userFindUnique.mockResolvedValue({
      id: "user-1",
      tenantId: "tenant-1",
      passwordHash: await hashPassword(password),
      role: Role.OWNER,
      deactivatedAt: new Date(),
    });

    await expect(
      login(db, jwtSecret, { tenantSlug, email, password }),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);
    expect(refreshTokenCreate).not.toHaveBeenCalled();
  });

  it("doğru bilgilerle geçerli access+refresh token üretir ve refresh token'ı hash'leyerek kaydeder", async () => {
    const { db, tenantFindUnique, userFindUnique, refreshTokenCreate } = createMockDb();
    tenantFindUnique.mockResolvedValue({ id: "tenant-1" });
    userFindUnique.mockResolvedValue({
      id: "user-1",
      tenantId: "tenant-1",
      passwordHash: await hashPassword(password),
      role: Role.OWNER,
      deactivatedAt: null,
    });

    const result = await login(db, jwtSecret, { tenantSlug, email, password });

    expect(verifyAccessToken(result.accessToken, jwtSecret)).toEqual({
      userId: "user-1",
      tenantId: "tenant-1",
      role: Role.OWNER,
    });
    expect(refreshTokenCreate).toHaveBeenCalledTimes(1);
    const createArgs = refreshTokenCreate.mock.calls[0]?.[0];
    expect(createArgs?.data.userId).toBe("user-1");
    expect(createArgs?.data.tokenHash).not.toBe(result.refreshToken);
    expect(result.refreshTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
