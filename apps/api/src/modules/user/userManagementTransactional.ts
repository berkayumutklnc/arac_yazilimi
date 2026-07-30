import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import { applyTenantScope } from "../../db/tenantScopedDb.js";
import {
  changeUserRole,
  deactivateUser,
  type UserManagementDb,
  type ActingUser,
} from "./userManagement.service.js";
import type { Role } from "../../generated/prisma/enums.js";

// bkz. docs/adr/0012-tenant-user-management-audit.md. changeUserRole/
// deactivateUser'ın saf, fake ile test edilmiş mantığını DEĞİŞTİRMEZ; yalnızca
// prisma.$transaction üzerinde çalışan ÜRETİM adaptörünü sağlar. Tenant
// kapsamlaması `tx` üzerinde applyTenantScope ile ELLE uygulanır (dealer
// modülünün buildScopedEcuFileDb deseni) — deaktivasyonun `deactivatedAt`
// yazması + TÜM refresh token'ların iptali + audit log AYNI transaction'da,
// biri diğerinden bağımsız commit edilemez.
function buildTransactionalDb(tx: Prisma.TransactionClient, tenantId: string): UserManagementDb {
  return {
    user: {
      findUnique: (args) =>
        tx.user.findUnique(
          applyTenantScope("User", "findUnique", args, tenantId) as Prisma.UserFindUniqueArgs,
        ),
      update: (args) =>
        tx.user.update(applyTenantScope("User", "update", args, tenantId) as Prisma.UserUpdateArgs),
      count: (args) =>
        tx.user.count(
          // ESLint'in proje servisi bu assertion'ı gereksiz görüyor ama `tsc
          // --noEmit` onsuz reddediyor (Record<string,unknown> ile Prisma'nın
          // üretilmiş dar count tipi arasındaki tutarsızlık) — bkz.
          // ecuFileUploadTransactional.ts'deki aynı bilinen Prisma sınırlaması.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          applyTenantScope("User", "count", args, tenantId) as Prisma.UserCountArgs,
        ),
    },
    userManagementAuditLog: {
      create: (args) =>
        tx.userManagementAuditLog.create(
          applyTenantScope(
            "UserManagementAuditLog",
            "create",
            args,
            tenantId,
          ) as Prisma.UserManagementAuditLogCreateArgs,
        ),
    },
    refreshToken: {
      updateMany: (args) => tx.refreshToken.updateMany(args),
    },
  };
}

export async function changeUserRoleTransactional(
  prisma: PrismaClient,
  tenantId: string,
  actingUser: ActingUser,
  targetUserId: string,
  newRole: Role,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const db = buildTransactionalDb(tx, tenantId);
    await changeUserRole(db, actingUser, targetUserId, newRole);
  });
}

export async function deactivateUserTransactional(
  prisma: PrismaClient,
  tenantId: string,
  actingUser: ActingUser,
  targetUserId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const db = buildTransactionalDb(tx, tenantId);
    await deactivateUser(db, actingUser, targetUserId);
  });
}
