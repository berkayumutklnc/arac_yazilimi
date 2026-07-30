import { describe, expect, it, vi } from "vitest";
import { logUserManagementAction, type UserManagementAuditLogDb } from "./userManagementAudit.js";
import { Role, UserManagementAction } from "../generated/prisma/enums.js";

describe("logUserManagementAction", () => {
  it("rol değişikliğini fromRole/toRole ile kaydeder", async () => {
    const create = vi.fn<UserManagementAuditLogDb["userManagementAuditLog"]["create"]>();
    const db: UserManagementAuditLogDb = { userManagementAuditLog: { create } };

    await logUserManagementAction(db, {
      actorId: "owner-1",
      targetUserId: "user-2",
      action: UserManagementAction.ROLE_CHANGED,
      fromRole: Role.ENGINEER,
      toRole: Role.RECEPTIONIST,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: "owner-1",
        targetUserId: "user-2",
        action: UserManagementAction.ROLE_CHANGED,
        fromRole: Role.ENGINEER,
        toRole: Role.RECEPTIONIST,
      },
    });
  });

  it("deaktivasyonu fromRole/toRole olmadan kaydeder", async () => {
    const create = vi.fn<UserManagementAuditLogDb["userManagementAuditLog"]["create"]>();
    const db: UserManagementAuditLogDb = { userManagementAuditLog: { create } };

    await logUserManagementAction(db, {
      actorId: "owner-1",
      targetUserId: "user-2",
      action: UserManagementAction.DEACTIVATED,
      fromRole: null,
      toRole: null,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: "owner-1",
        targetUserId: "user-2",
        action: UserManagementAction.DEACTIVATED,
        fromRole: null,
        toRole: null,
      },
    });
  });
});
