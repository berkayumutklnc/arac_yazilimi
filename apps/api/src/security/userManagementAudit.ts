import type { Role } from "../generated/prisma/enums.js";
import type { UserManagementAction } from "../generated/prisma/enums.js";

// bkz. docs/adr/0012-tenant-user-management-audit.md. AccessDeniedAuditLog ile
// aynı desen — tenantId bilinçli olarak yok, db request başına tenant-scoped
// oluşturulur (bkz. db/tenantScopedDb.ts).
export interface UserManagementAuditLogDb {
  userManagementAuditLog: {
    create: (args: {
      data: {
        actorId: string;
        targetUserId: string;
        action: UserManagementAction;
        fromRole: Role | null;
        toRole: Role | null;
      };
    }) => Promise<unknown>;
  };
}

export interface LogUserManagementActionParams {
  actorId: string;
  targetUserId: string;
  action: UserManagementAction;
  fromRole: Role | null;
  toRole: Role | null;
}

export async function logUserManagementAction(
  db: UserManagementAuditLogDb,
  params: LogUserManagementActionParams,
): Promise<void> {
  await db.userManagementAuditLog.create({
    data: {
      actorId: params.actorId,
      targetUserId: params.targetUserId,
      action: params.action,
      fromRole: params.fromRole,
      toRole: params.toRole,
    },
  });
}
