import { describe, expect, it, vi } from "vitest";
import { redeemInvitationTransactional } from "./invitationRedemptionTransactional.js";
import { InvalidInvitationTokenError } from "./invitationRedemption.service.js";
import { Role } from "../../generated/prisma/enums.js";
import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";

// fileRequestFulfillmentTransactional.test.ts ile aynı yaklaşım: gerçek bir
// DB'ye değil, adaptörün mantığına (guard'lı updateMany, P2002 -> generic hata
// çevirimi) fake bir `tx` ile doğrular — gerçek eşzamanlı davranış yalnızca
// entegrasyon testinde (gerçek Postgres) doğrulanabilir.

const rawToken = "c".repeat(64);

function invitationRow(overrides: Record<string, unknown> = {}) {
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

function createFakeTx(overrides: { userCreateError?: unknown } = {}) {
  const invitationFindUnique = vi.fn().mockResolvedValue(invitationRow());
  const invitationUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const userCreate = overrides.userCreateError
    ? vi.fn().mockRejectedValue(overrides.userCreateError)
    : vi.fn().mockResolvedValue({ id: "user-1" });

  const tx = {
    invitation: { findUnique: invitationFindUnique, updateMany: invitationUpdateMany },
    user: { create: userCreate },
  };

  return { tx, invitationFindUnique, invitationUpdateMany, userCreate };
}

function createFakePrisma(tx: unknown) {
  const $transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(tx));
  const prisma = { $transaction } as unknown as PrismaClient;
  return { prisma, $transaction };
}

describe("redeemInvitationTransactional", () => {
  it("prisma.$transaction içinde tek bir işlem olarak çalışır", async () => {
    const { tx } = createFakeTx();
    const { prisma, $transaction } = createFakePrisma(tx);

    await redeemInvitationTransactional(prisma, rawToken, "yeni-guclu-sifre-123");

    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("başarılı redemption'da userId döner", async () => {
    const { tx } = createFakeTx();
    const { prisma } = createFakePrisma(tx);

    const result = await redeemInvitationTransactional(prisma, rawToken, "yeni-guclu-sifre-123");

    expect(result).toEqual({ userId: "user-1" });
  });

  it("user.create() DB'nin (tenantId,email) unique index'ine (P2002) çarparsa — davet kabul edilirken aynı e-postayla zaten bir kullanıcı oluşmuşsa — generic InvalidInvitationTokenError'a çevirir", async () => {
    const { tx } = createFakeTx({
      userCreateError: new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.0.0",
      }),
    });
    const { prisma } = createFakePrisma(tx);

    await expect(
      redeemInvitationTransactional(prisma, rawToken, "yeni-guclu-sifre-123"),
    ).rejects.toBeInstanceOf(InvalidInvitationTokenError);
  });

  it("P2002 dışındaki bir hatayı olduğu gibi yeniden fırlatır", async () => {
    const { tx } = createFakeTx({ userCreateError: new Error("beklenmeyen DB hatası") });
    const { prisma } = createFakePrisma(tx);

    await expect(
      redeemInvitationTransactional(prisma, rawToken, "yeni-guclu-sifre-123"),
    ).rejects.toThrow("beklenmeyen DB hatası");
  });
});
