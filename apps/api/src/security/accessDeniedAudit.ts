import type { Role } from "../generated/prisma/enums.js";
import type { AccessDeniedReason, AccessDeniedResource } from "../generated/prisma/enums.js";

// bkz. docs/adr/0008-access-denied-audit-log.md, docs/security-audit.md DÜŞÜK-3.
// tenantId bilinçli olarak yok — db, request başına tenant-scoped oluşturulur
// (bkz. db/tenantScopedDb.ts, ADR 0006/0008). Yalnızca ECU dosyası
// indirme/yükleme route'larında kullanılır (bkz. ADR 0008 kapsam kısıtı).
export interface AccessDeniedAuditLogDb {
  accessDeniedAuditLog: {
    create: (args: {
      data: {
        actorId: string;
        actorRole: Role;
        resource: AccessDeniedResource;
        resourceId: string | null;
        reason: AccessDeniedReason;
      };
    }) => Promise<unknown>;
  };
}

export interface LogAccessDeniedParams {
  actorId: string;
  actorRole: Role;
  resource: AccessDeniedResource;
  resourceId: string | null;
  reason: AccessDeniedReason;
}

export async function logAccessDenied(
  db: AccessDeniedAuditLogDb,
  params: LogAccessDeniedParams,
): Promise<void> {
  await db.accessDeniedAuditLog.create({
    data: {
      actorId: params.actorId,
      actorRole: params.actorRole,
      resource: params.resource,
      resourceId: params.resourceId,
      reason: params.reason,
    },
  });
}
