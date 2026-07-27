import { Role } from "../../generated/prisma/enums.js";

export class ForbiddenRoleError extends Error {
  constructor(public readonly role: Role) {
    super(`Rol "${role}" ECU dosyası indiremez; yalnızca OWNER/ENGINEER yetkilidir.`);
    this.name = "ForbiddenRoleError";
  }
}

export class EcuFileNotFoundError extends Error {
  constructor(ecuFileId: string) {
    super(`ECU dosyası bulunamadı: ${ecuFileId}`);
    this.name = "EcuFileNotFoundError";
  }
}

const ALLOWED_DOWNLOAD_ROLES: readonly Role[] = [Role.OWNER, Role.ENGINEER];

interface EcuFileDownloadRecord {
  id: string;
  tenantId: string;
  storageKey: string;
}

export interface EcuFileDownloadDb {
  ecuFile: {
    findUnique: (args: {
      where: { id: string; tenantId: string };
    }) => Promise<EcuFileDownloadRecord | null>;
  };
  ecuFileDownloadAuditLog: {
    create: (args: {
      data: {
        tenantId: string;
        ecuFileId: string;
        downloadedBy: string;
        downloadedByRole: Role;
      };
    }) => Promise<unknown>;
  };
}

export interface EcuFileDownloadStoragePort {
  createPresignedDownloadUrl(params: { key: string }): Promise<{ downloadUrl: string }>;
}

export interface DownloadEcuFileParams {
  tenantId: string;
  ecuFileId: string;
  requestedBy: { id: string; role: Role };
}

export async function downloadEcuFile(
  deps: { db: EcuFileDownloadDb; storage: EcuFileDownloadStoragePort },
  params: DownloadEcuFileParams,
): Promise<{ downloadUrl: string }> {
  if (!ALLOWED_DOWNLOAD_ROLES.includes(params.requestedBy.role)) {
    throw new ForbiddenRoleError(params.requestedBy.role);
  }

  const file = await deps.db.ecuFile.findUnique({
    where: { id: params.ecuFileId, tenantId: params.tenantId },
  });

  if (!file) {
    throw new EcuFileNotFoundError(params.ecuFileId);
  }

  const { downloadUrl } = await deps.storage.createPresignedDownloadUrl({ key: file.storageKey });

  await deps.db.ecuFileDownloadAuditLog.create({
    data: {
      tenantId: params.tenantId,
      ecuFileId: file.id,
      downloadedBy: params.requestedBy.id,
      downloadedByRole: params.requestedBy.role,
    },
  });

  return { downloadUrl };
}
