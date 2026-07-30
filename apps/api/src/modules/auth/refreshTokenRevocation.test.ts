import { describe, expect, it, vi } from "vitest";
import { revokeAllRefreshTokensForUser, type RevokeAllRefreshTokensDb } from "./refreshTokenRevocation.js";

function createMockDb() {
  const updateMany = vi.fn<RevokeAllRefreshTokensDb["refreshToken"]["updateMany"]>();
  const db: RevokeAllRefreshTokensDb = { refreshToken: { updateMany } };
  return { db, updateMany };
}

describe("revokeAllRefreshTokensForUser", () => {
  it("kullanıcının tüm aktif (revokedAt=null) refresh token'larını iptal eder", async () => {
    const { db, updateMany } = createMockDb();

    await revokeAllRefreshTokensForUser(db, "user-1");

    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });
});
