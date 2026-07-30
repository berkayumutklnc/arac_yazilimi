import { Role, UserManagementAction } from "../../generated/prisma/enums.js";
import { logUserManagementAction, type UserManagementAuditLogDb } from "../../security/userManagementAudit.js";
import {
  revokeAllRefreshTokensForUser,
  type RevokeAllRefreshTokensDb,
} from "../auth/refreshTokenRevocation.js";

export class CannotModifySelfError extends Error {
  constructor() {
    super("Kendi rolünüzü değiştiremez veya kendinizi deaktive edemezsiniz.");
    this.name = "CannotModifySelfError";
  }
}

export class CannotRemoveLastOwnerError extends Error {
  constructor() {
    super("Tenant'ın tek aktif OWNER'ı rolü değiştirilemez veya deaktive edilemez.");
    this.name = "CannotRemoveLastOwnerError";
  }
}

export class UserNotFoundError extends Error {
  constructor(userId: string) {
    super(`Kullanıcı bulunamadı: ${userId}`);
    this.name = "UserNotFoundError";
  }
}

interface UserRecord {
  id: string;
  tenantId: string;
  role: Role;
  deactivatedAt: Date | null;
}

interface UserWithEmail extends UserRecord {
  email: string;
  createdAt: Date;
}

export interface UserManagementDb extends UserManagementAuditLogDb, RevokeAllRefreshTokensDb {
  user: {
    findUnique: (args: { where: { id: string } }) => Promise<UserRecord | null>;
    update: (args: {
      where: { id: string };
      data: { role: Role } | { deactivatedAt: Date };
    }) => Promise<unknown>;
    count: (args: { where: { role: Role; deactivatedAt: null } }) => Promise<number>;
  };
}

// listTenantUsers, değişiklik yapan diğer fonksiyonlardan bağımsız, ayrı bir
// dar arayüz kullanır — UserManagementDb'yi (yalnızca yazma işlemleri
// gerektiren) her çağıranı findMany implemente etmeye zorlamamak için.
export interface UserListDb {
  user: {
    findMany: (args: {
      where: { tenantId: string };
      orderBy: { createdAt: "desc" };
    }) => Promise<UserWithEmail[]>;
  };
}

export interface ActingUser {
  id: string;
  tenantId: string;
  role: Role;
}

async function loadTargetInTenant(
  db: Pick<UserManagementDb, "user">,
  actingUser: ActingUser,
  targetUserId: string,
): Promise<UserRecord> {
  if (actingUser.id === targetUserId) {
    throw new CannotModifySelfError();
  }
  const target = await db.user.findUnique({ where: { id: targetUserId } });
  if (!target || target.tenantId !== actingUser.tenantId) {
    throw new UserNotFoundError(targetUserId);
  }
  return target;
}

async function assertNotLastActiveOwner(db: Pick<UserManagementDb, "user">, target: UserRecord): Promise<void> {
  if (target.role !== Role.OWNER) {
    return;
  }
  const activeOwners = await db.user.count({ where: { role: Role.OWNER, deactivatedAt: null } });
  if (activeOwners <= 1) {
    throw new CannotRemoveLastOwnerError();
  }
}

export async function changeUserRole(
  db: UserManagementDb,
  actingUser: ActingUser,
  targetUserId: string,
  newRole: Role,
): Promise<void> {
  const target = await loadTargetInTenant(db, actingUser, targetUserId);
  if (newRole !== Role.OWNER) {
    await assertNotLastActiveOwner(db, target);
  }

  await db.user.update({ where: { id: targetUserId }, data: { role: newRole } });
  await logUserManagementAction(db, {
    actorId: actingUser.id,
    targetUserId,
    action: UserManagementAction.ROLE_CHANGED,
    fromRole: target.role,
    toRole: newRole,
  });
}

export async function deactivateUser(
  db: UserManagementDb,
  actingUser: ActingUser,
  targetUserId: string,
): Promise<void> {
  const target = await loadTargetInTenant(db, actingUser, targetUserId);
  await assertNotLastActiveOwner(db, target);

  await db.user.update({ where: { id: targetUserId }, data: { deactivatedAt: new Date() } });
  // Anında iptal — deaktive edilen kullanıcının mevcut refresh token'ı bir
  // sonraki /auth/refresh çağrısında reddedilir (bkz. ADR 0012).
  await revokeAllRefreshTokensForUser(db, targetUserId);
  await logUserManagementAction(db, {
    actorId: actingUser.id,
    targetUserId,
    action: UserManagementAction.DEACTIVATED,
    fromRole: null,
    toRole: null,
  });
}

export async function listTenantUsers(db: UserListDb, tenantId: string): Promise<UserWithEmail[]> {
  return db.user.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
}
