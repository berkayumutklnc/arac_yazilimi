import { describe, expect, it, vi } from "vitest";
import { refreshTokens, InvalidRefreshTokenError, type AuthRefreshDb } from "./authRefresh.service.js";
import { verifyAccessToken } from "./authToken.js";
import { Role } from "../../generated/prisma/enums.js";

const jwtSecret = "test-secret";
const presentedToken = "a".repeat(64); // hex-benzeri opak token

function createMockDb() {
  const findUnique = vi.fn<AuthRefreshDb["refreshToken"]["findUnique"]>();
  const update = vi.fn<AuthRefreshDb["refreshToken"]["update"]>();
  const create = vi.fn<AuthRefreshDb["refreshToken"]["create"]>();
  const updateMany = vi.fn<AuthRefreshDb["refreshToken"]["updateMany"]>();
  const userFindUnique = vi.fn<AuthRefreshDb["user"]["findUnique"]>();
  const db: AuthRefreshDb = {
    refreshToken: { findUnique, update, create, updateMany },
    user: { findUnique: userFindUnique },
  };
  return { db, findUnique, update, create, updateMany, userFindUnique };
}

function futureDate(msFromNow = 60_000): Date {
  return new Date(Date.now() + msFromNow);
}

function pastDate(msAgo = 60_000): Date {
  return new Date(Date.now() - msAgo);
}

describe("refreshTokens", () => {
  it("bilinmeyen token için InvalidRefreshTokenError fırlatır", async () => {
    const { db, findUnique, create } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(refreshTokens(db, jwtSecret, presentedToken)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("zaten iptal edilmiş (revoked) bir token tekrar sunulursa — çalıntı belirtisi — kullanıcının TÜM token'ları iptal edilir", async () => {
    const { db, findUnique, updateMany, create } = createMockDb();
    findUnique.mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      expiresAt: futureDate(),
      revokedAt: pastDate(),
    });

    await expect(refreshTokens(db, jwtSecret, presentedToken)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("süresi dolmuş (ama iptal edilmemiş) token için InvalidRefreshTokenError fırlatır, rotasyon yapılmaz", async () => {
    const { db, findUnique, create } = createMockDb();
    findUnique.mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      expiresAt: pastDate(),
      revokedAt: null,
    });

    await expect(refreshTokens(db, jwtSecret, presentedToken)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("kullanıcı artık yoksa InvalidRefreshTokenError fırlatır", async () => {
    const { db, findUnique, userFindUnique, create } = createMockDb();
    findUnique.mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      expiresAt: futureDate(),
      revokedAt: null,
    });
    userFindUnique.mockResolvedValue(null);

    await expect(refreshTokens(db, jwtSecret, presentedToken)).rejects.toBeInstanceOf(
      InvalidRefreshTokenError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("geçerli token: rotasyon yapılır — eski token replacedById ile iptal edilir, yeni token + geçerli access token döner", async () => {
    const { db, findUnique, update, create, userFindUnique } = createMockDb();
    findUnique.mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      expiresAt: futureDate(),
      revokedAt: null,
    });
    userFindUnique.mockResolvedValue({ id: "user-1", tenantId: "tenant-1", role: Role.ENGINEER });
    create.mockResolvedValue({ id: "rt-2" });

    const result = await refreshTokens(db, jwtSecret, presentedToken);

    expect(result.refreshToken).not.toBe(presentedToken);
    expect(verifyAccessToken(result.accessToken, jwtSecret)).toEqual({
      userId: "user-1",
      tenantId: "tenant-1",
      role: Role.ENGINEER,
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: "rt-1" },
      data: { revokedAt: expect.any(Date) as Date, replacedById: "rt-2" },
    });
  });
});
