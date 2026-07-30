import { describe, expect, it, vi } from "vitest";
import {
  previewInvitation,
  redeemInvitation,
  InvalidInvitationTokenError,
  type InvitationRedemptionDb,
} from "./invitationRedemption.service.js";
import { hashInvitationToken } from "./invitationToken.js";
import { Role } from "../../generated/prisma/enums.js";

const rawToken = "b".repeat(64);

function createMockDb() {
  const findUnique = vi.fn<InvitationRedemptionDb["invitation"]["findUnique"]>();
  const updateMany = vi.fn<InvitationRedemptionDb["invitation"]["updateMany"]>();
  const userCreate = vi.fn<InvitationRedemptionDb["user"]["create"]>();
  const db: InvitationRedemptionDb = {
    invitation: { findUnique, updateMany },
    user: { create: userCreate },
  };
  return { db, findUnique, updateMany, userCreate };
}

function validInvitationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    tenantId: "tenant-1",
    email: "new@acme.test",
    role: Role.ENGINEER,
    expiresAt: new Date(Date.now() + 60_000),
    acceptedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("previewInvitation", () => {
  it("geçerli bir token için tenantId/email/role önizlemesi döner", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(validInvitationRow());

    const result = await previewInvitation(db, rawToken);

    expect(result).toEqual({ tenantId: "tenant-1", email: "new@acme.test", role: Role.ENGINEER });
    expect(findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashInvitationToken(rawToken) } });
  });

  it("bilinmeyen token için InvalidInvitationTokenError fırlatır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(previewInvitation(db, rawToken)).rejects.toBeInstanceOf(InvalidInvitationTokenError);
  });

  it("süresi dolmuş token için InvalidInvitationTokenError fırlatır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(validInvitationRow({ expiresAt: new Date(Date.now() - 1000) }));

    await expect(previewInvitation(db, rawToken)).rejects.toBeInstanceOf(InvalidInvitationTokenError);
  });

  it("zaten kabul edilmiş token için InvalidInvitationTokenError fırlatır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(validInvitationRow({ acceptedAt: new Date() }));

    await expect(previewInvitation(db, rawToken)).rejects.toBeInstanceOf(InvalidInvitationTokenError);
  });

  it("iptal edilmiş token için InvalidInvitationTokenError fırlatır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(validInvitationRow({ revokedAt: new Date() }));

    await expect(previewInvitation(db, rawToken)).rejects.toBeInstanceOf(InvalidInvitationTokenError);
  });
});

describe("redeemInvitation", () => {
  it("geçerli tokenla kullanıcı oluşturur, daveti tek-kullanımlık olarak işaretler", async () => {
    const { db, findUnique, updateMany, userCreate } = createMockDb();
    findUnique.mockResolvedValue(validInvitationRow());
    updateMany.mockResolvedValue({ count: 1 });
    userCreate.mockResolvedValue({ id: "user-1" });

    const result = await redeemInvitation(db, rawToken, "yeni-guclu-sifre-123");

    expect(result).toEqual({ userId: "user-1" });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "inv-1", acceptedAt: null },
      data: { acceptedAt: expect.any(Date) as Date },
    });
    const createArgs = userCreate.mock.calls[0]?.[0];
    expect(createArgs?.data.tenantId).toBe("tenant-1");
    expect(createArgs?.data.email).toBe("new@acme.test");
    expect(createArgs?.data.role).toBe(Role.ENGINEER);
    expect(createArgs?.data.passwordHash).not.toBe("yeni-guclu-sifre-123");
  });

  it("eşzamanlı iki redemption'dan ikincisi (updateMany 0 satır etkiler) InvalidInvitationTokenError fırlatır", async () => {
    const { db, findUnique, updateMany, userCreate } = createMockDb();
    findUnique.mockResolvedValue(validInvitationRow());
    updateMany.mockResolvedValue({ count: 0 });

    await expect(redeemInvitation(db, rawToken, "yeni-guclu-sifre-123")).rejects.toBeInstanceOf(
      InvalidInvitationTokenError,
    );
    expect(userCreate).not.toHaveBeenCalled();
  });

  it("geçersiz (yok/süresi dolmuş/kabul edilmiş/iptal edilmiş) token için kullanıcı oluşturmadan InvalidInvitationTokenError fırlatır", async () => {
    const { db, findUnique, updateMany, userCreate } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(redeemInvitation(db, rawToken, "yeni-guclu-sifre-123")).rejects.toBeInstanceOf(
      InvalidInvitationTokenError,
    );
    expect(updateMany).not.toHaveBeenCalled();
    expect(userCreate).not.toHaveBeenCalled();
  });
});
