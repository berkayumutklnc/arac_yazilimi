import { randomUUID } from "node:crypto";
import { detectIllegalContent, type IllegalContentMatch } from "./ecuFilePolicy.js";
import { createEcuFile, type EcuFileDb, type CreateEcuFileInput } from "./ecuFile.service.js";

export class IllegalContentDetectedError extends Error {
  constructor(public readonly match: IllegalContentMatch) {
    super(`Yükleme reddedildi: yasaklı içerik kalıbı tespit edildi (${match.label}).`);
    this.name = "IllegalContentDetectedError";
  }
}

export class ChecksumMismatchError extends Error {
  constructor(
    public readonly claimed: string,
    public readonly actual: string,
  ) {
    super(`Hash uyuşmazlığı: istemci "${claimed}", sunucu "${actual}" hesapladı.`);
    this.name = "ChecksumMismatchError";
  }
}

export class DuplicateEcuFileError extends Error {
  constructor(public readonly existingFileId: string) {
    super(`Bu araç için aynı hash'e sahip bir dosya zaten kayıtlı: ${existingFileId}`);
    this.name = "DuplicateEcuFileError";
  }
}

export interface EcuFileStoragePort {
  createPresignedUploadUrl(params: { key: string }): Promise<{ uploadUrl: string; key: string }>;
  readObjectSha256(params: { key: string }): Promise<string>;
}

export interface RequestEcuFileUploadParams {
  tenantId: string;
  vehicleId: string;
  fileName: string;
}

export interface RequestEcuFileUploadResult {
  uploadUrl: string;
  storageKey: string;
}

// Güvenlik (bkz. docs/security-audit.md, YÜKSEK-1): fileName istemciden
// gelen güvenilmeyen bir değer. Sanitize edilmeden storage key'e eklenirse
// "/" veya ".." ile öngörülen tenantId/vehicleId önekinin dışına taşan bir
// anahtar üretilebilir (S3 anahtar enjeksiyonu; dosya sistemi tabanlı bir
// storage adaptöründe path traversal). Sadece güvenli karakterlere izin ver.
function sanitizeFileNameForStorageKey(fileName: string): string {
  const withoutSeparators = fileName.replace(/[/\\]+/g, "_");
  const withoutDotDot = withoutSeparators.replace(/\.\.+/g, "_");
  const safe = withoutDotDot.replace(/[^a-zA-Z0-9._-]/g, "_");
  const trimmed = safe.slice(-200);
  return trimmed.length > 0 ? trimmed : "file";
}

export async function requestEcuFileUpload(
  storage: Pick<EcuFileStoragePort, "createPresignedUploadUrl">,
  params: RequestEcuFileUploadParams,
): Promise<RequestEcuFileUploadResult> {
  const illegalMatch = detectIllegalContent(params.fileName);
  if (illegalMatch) {
    throw new IllegalContentDetectedError(illegalMatch);
  }

  const safeFileName = sanitizeFileNameForStorageKey(params.fileName);
  const key = `${params.tenantId}/${params.vehicleId}/${randomUUID()}-${safeFileName}`;
  const { uploadUrl, key: storageKey } = await storage.createPresignedUploadUrl({ key });
  return { uploadUrl, storageKey };
}

export interface EcuFileUploadDb extends EcuFileDb {
  ecuFile: EcuFileDb["ecuFile"] & {
    findFirst: (args: {
      where: { tenantId: string; vehicleId: string; checksum: string };
    }) => Promise<{ id: string } | null>;
  };
}

export type ConfirmEcuFileUploadParams = Omit<CreateEcuFileInput, "checksum"> & {
  claimedChecksum: string;
};

export async function confirmEcuFileUpload(
  deps: { db: EcuFileUploadDb; storage: Pick<EcuFileStoragePort, "readObjectSha256"> },
  params: ConfirmEcuFileUploadParams,
) {
  const actualChecksum = await deps.storage.readObjectSha256({ key: params.storageKey });

  if (actualChecksum !== params.claimedChecksum) {
    throw new ChecksumMismatchError(params.claimedChecksum, actualChecksum);
  }

  const duplicate = await deps.db.ecuFile.findFirst({
    where: {
      tenantId: params.tenantId,
      vehicleId: params.vehicleId,
      checksum: actualChecksum,
    },
  });

  if (duplicate) {
    throw new DuplicateEcuFileError(duplicate.id);
  }

  return createEcuFile(deps.db, {
    tenantId: params.tenantId,
    vehicleId: params.vehicleId,
    fileType: params.fileType,
    storageKey: params.storageKey,
    checksum: actualChecksum,
    uploadedBy: params.uploadedBy,
    stockRomRef: params.stockRomRef,
  });
}
