import { describe, expect, it, vi } from "vitest";
import { createInvitation, listInvitations, type InvitationDb } from "./invitation.service.js";
import { Role } from "../../generated/prisma/enums.js";

function createMockDb() {
  const create = vi.fn<InvitationDb["invitation"]["create"]>();
  const findMany = vi.fn<InvitationDb["invitation"]["findMany"]>();
  const db: InvitationDb = { invitation: { create, findMany } };
  return { db, create, findMany };
}

describe("createInvitation", () => {
  it("hash'lenmiş bir token ile davet oluşturur, ham token'ı yalnızca dönüş değerinde taşır", async () => {
    const { db, create } = createMockDb();
    create.mockResolvedValue({
      id: "inv-1",
      tenantId: "tenant-1",
      email: "new@acme.test",
      role: Role.ENGINEER,
      tokenHash: "irrelevant-in-mock",
      invitedBy: "owner-1",
      expiresAt: new Date(Date.now() + 1000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    });

    const result = await createInvitation(db, {
      tenantId: "tenant-1",
      email: "new@acme.test",
      role: Role.ENGINEER,
      invitedBy: "owner-1",
    });

    expect(create).toHaveBeenCalledTimes(1);
    const createArgs = create.mock.calls[0]?.[0];
    expect(createArgs?.data.tenantId).toBe("tenant-1");
    expect(createArgs?.data.email).toBe("new@acme.test");
    expect(createArgs?.data.tokenHash).not.toBe(result.rawToken);
    expect(result.rawToken).toHaveLength(64);
    expect(result.invitation.id).toBe("inv-1");
  });
});

describe("listInvitations", () => {
  it("verilen tenant için davetleri olduğu gibi listeler", async () => {
    const { db, findMany } = createMockDb();
    findMany.mockResolvedValue([]);

    await listInvitations(db, "tenant-1");

    expect(findMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1" },
      orderBy: { createdAt: "desc" },
    });
  });
});
