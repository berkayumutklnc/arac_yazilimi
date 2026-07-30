import { describe, expect, it, vi } from "vitest";
import {
  changeUserRole,
  deactivateUser,
  CannotModifySelfError,
  CannotRemoveLastOwnerError,
  UserNotFoundError,
  type UserManagementDb,
  type ActingUser,
} from "./userManagement.service.js";
import { Role, UserManagementAction } from "../../generated/prisma/enums.js";

const tenantId = "tenant-1";
const owner: ActingUser = { id: "owner-1", tenantId, role: Role.OWNER };

function createMockDb() {
  const findUnique = vi.fn<UserManagementDb["user"]["findUnique"]>();
  const update = vi.fn<UserManagementDb["user"]["update"]>();
  const count = vi.fn<UserManagementDb["user"]["count"]>();
  const auditCreate = vi.fn<UserManagementDb["userManagementAuditLog"]["create"]>();
  const refreshTokenUpdateMany = vi.fn<UserManagementDb["refreshToken"]["updateMany"]>();
  const db: UserManagementDb = {
    user: { findUnique, update, count },
    userManagementAuditLog: { create: auditCreate },
    refreshToken: { updateMany: refreshTokenUpdateMany },
  };
  return { db, findUnique, update, count, auditCreate, refreshTokenUpdateMany };
}

describe("changeUserRole", () => {
  it("bir OWNER kendi rolünü değiştiremez (CannotModifySelfError)", async () => {
    const { db } = createMockDb();

    await expect(changeUserRole(db, owner, owner.id, Role.ENGINEER)).rejects.toBeInstanceOf(
      CannotModifySelfError,
    );
  });

  it("hedef kullanıcı başka bir tenant'a aitse UserNotFoundError fırlatır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue({ id: "user-2", tenantId: "other-tenant", role: Role.ENGINEER, deactivatedAt: null });

    await expect(changeUserRole(db, owner, "user-2", Role.RECEPTIONIST)).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });

  it("hedef kullanıcı yoksa UserNotFoundError fırlatır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(changeUserRole(db, owner, "user-2", Role.RECEPTIONIST)).rejects.toBeInstanceOf(
      UserNotFoundError,
    );
  });

  it("tenant'ın tek aktif OWNER'ının rolü OWNER dışına değiştirilemez (CannotRemoveLastOwnerError)", async () => {
    const { db, findUnique, count, update } = createMockDb();
    findUnique.mockResolvedValue({ id: "user-2", tenantId, role: Role.OWNER, deactivatedAt: null });
    count.mockResolvedValue(1);

    await expect(changeUserRole(db, owner, "user-2", Role.ENGINEER)).rejects.toBeInstanceOf(
      CannotRemoveLastOwnerError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("birden fazla aktif OWNER varsa birinin rolü değiştirilebilir", async () => {
    const { db, findUnique, count, update, auditCreate } = createMockDb();
    findUnique.mockResolvedValue({ id: "user-2", tenantId, role: Role.OWNER, deactivatedAt: null });
    count.mockResolvedValue(2);

    await changeUserRole(db, owner, "user-2", Role.ENGINEER);

    expect(update).toHaveBeenCalledWith({ where: { id: "user-2" }, data: { role: Role.ENGINEER } });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorId: owner.id,
        targetUserId: "user-2",
        action: UserManagementAction.ROLE_CHANGED,
        fromRole: Role.OWNER,
        toRole: Role.ENGINEER,
      },
    });
  });

  it("ENGINEER -> RECEPTIONIST gibi OWNER dışı değişikliklerde son-OWNER kontrolü hiç çalışmaz", async () => {
    const { db, findUnique, count, update } = createMockDb();
    findUnique.mockResolvedValue({ id: "user-2", tenantId, role: Role.ENGINEER, deactivatedAt: null });

    await changeUserRole(db, owner, "user-2", Role.RECEPTIONIST);

    expect(count).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: "user-2" }, data: { role: Role.RECEPTIONIST } });
  });
});

describe("deactivateUser", () => {
  it("bir OWNER kendini deaktive edemez (CannotModifySelfError)", async () => {
    const { db } = createMockDb();

    await expect(deactivateUser(db, owner, owner.id)).rejects.toBeInstanceOf(CannotModifySelfError);
  });

  it("hedef kullanıcı başka bir tenant'a aitse UserNotFoundError fırlatır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue({ id: "user-2", tenantId: "other-tenant", role: Role.ENGINEER, deactivatedAt: null });

    await expect(deactivateUser(db, owner, "user-2")).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it("tenant'ın tek aktif OWNER'ı deaktive edilemez (CannotRemoveLastOwnerError)", async () => {
    const { db, findUnique, count, update } = createMockDb();
    findUnique.mockResolvedValue({ id: "user-2", tenantId, role: Role.OWNER, deactivatedAt: null });
    count.mockResolvedValue(1);

    await expect(deactivateUser(db, owner, "user-2")).rejects.toBeInstanceOf(CannotRemoveLastOwnerError);
    expect(update).not.toHaveBeenCalled();
  });

  it("başarılı deaktivasyon: deactivatedAt set edilir, TÜM refresh token'lar iptal edilir, audit loglanır", async () => {
    const { db, findUnique, update, refreshTokenUpdateMany, auditCreate } = createMockDb();
    findUnique.mockResolvedValue({ id: "user-2", tenantId, role: Role.ENGINEER, deactivatedAt: null });

    await deactivateUser(db, owner, "user-2");

    expect(update).toHaveBeenCalledWith({
      where: { id: "user-2" },
      data: { deactivatedAt: expect.any(Date) as Date },
    });
    expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-2", revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: {
        actorId: owner.id,
        targetUserId: "user-2",
        action: UserManagementAction.DEACTIVATED,
        fromRole: null,
        toRole: null,
      },
    });
  });
});
