import { describe, expect, it, vi } from "vitest";
import { logAccessDenied, type AccessDeniedAuditLogDb } from "./accessDeniedAudit.js";
import { Role, AccessDeniedResource, AccessDeniedReason } from "../generated/prisma/enums.js";

describe("logAccessDenied", () => {
  it("verilen alanlarla accessDeniedAuditLog.create çağırır — tenantId parametre olarak yok (db zaten scoped)", async () => {
    const create = vi.fn<AccessDeniedAuditLogDb["accessDeniedAuditLog"]["create"]>();
    const db: AccessDeniedAuditLogDb = { accessDeniedAuditLog: { create } };

    await logAccessDenied(db, {
      actorId: "user-1",
      actorRole: Role.DEALER,
      resource: AccessDeniedResource.ECU_FILE_DOWNLOAD,
      resourceId: "ecu-file-1",
      reason: AccessDeniedReason.FORBIDDEN_ROLE,
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        actorId: "user-1",
        actorRole: Role.DEALER,
        resource: AccessDeniedResource.ECU_FILE_DOWNLOAD,
        resourceId: "ecu-file-1",
        reason: AccessDeniedReason.FORBIDDEN_ROLE,
      },
    });
  });

  it("resourceId null olabilir (kaynak henüz/hiç belirlenemeyen durumlar)", async () => {
    const create = vi.fn<AccessDeniedAuditLogDb["accessDeniedAuditLog"]["create"]>();
    const db: AccessDeniedAuditLogDb = { accessDeniedAuditLog: { create } };

    await logAccessDenied(db, {
      actorId: "user-2",
      actorRole: Role.RECEPTIONIST,
      resource: AccessDeniedResource.ECU_FILE_UPLOAD,
      resourceId: null,
      reason: AccessDeniedReason.NOT_FOUND,
    });

    const args = create.mock.calls[0]?.[0];
    expect(args?.data.resourceId).toBeNull();
  });
});
