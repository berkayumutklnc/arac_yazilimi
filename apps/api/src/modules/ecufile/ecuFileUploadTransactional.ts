import { Prisma, type PrismaClient } from "../../generated/prisma/client.js";
import { applyTenantScope } from "../../db/tenantScopedDb.js";
import {
  confirmEcuFileUpload,
  DuplicateEcuFileError,
  type ConfirmEcuFileUploadParams,
  type EcuFileStoragePort,
  type EcuFileUploadDb,
} from "./ecuFileUpload.service.js";

// bkz. docs/adr/0007-credit-deduction-locking-strategy.md. confirmEcuFileUpload
// (ecuFileUpload.service.ts) saf mantığındaki findFirst+create check-then-act
// deseni TEK BAŞINA yarış koşuluna karşı yetersizdi: iki eşzamanlı yükleme
// aynı anda findFirst çalıştırıp ikisi de "mükerrer yok" görebilir. Asıl
// savunma artık DB'deki EcuFile(tenantId, vehicleId, checksum) unique
// index'i — ikinci create() P2002 ile reddedilir, burada yakalanıp mevcut
// kaydın id'siyle DuplicateEcuFileError'a çevrilir.
const UNIQUE_VIOLATION_CODE = "P2002";

function buildTransactionalDb(tx: Prisma.TransactionClient, tenantId: string): EcuFileUploadDb {
  return {
    vehicle: {
      findUnique: (args) =>
        tx.vehicle.findUnique(
          applyTenantScope("Vehicle", "findUnique", args, tenantId) as Prisma.VehicleFindUniqueArgs,
        ),
    },
    ecuFile: {
      create: (args) =>
        tx.ecuFile.create(
          applyTenantScope("EcuFile", "create", args, tenantId) as Prisma.EcuFileCreateArgs,
        ),
      findUnique: (args) =>
        tx.ecuFile.findUnique(
          applyTenantScope(
            "EcuFile",
            "findUnique",
            args,
            tenantId,
          ) as Prisma.EcuFileFindUniqueArgs,
        ),
      findFirst: (args) =>
        tx.ecuFile.findFirst(
          // ESLint'in proje servisi bu assertion'ı gereksiz görüyor ama `tsc
          // --noEmit` onsuz reddediyor (Record<string,unknown> ile Prisma'nın
          // üretilmiş dar findFirst tipi arasındaki tutarsızlık) — bkz.
          // db/tenantScopedDb.ts'deki benzer not, aynı bilinen Prisma sınırlaması.
          // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
          applyTenantScope("EcuFile", "findFirst", args, tenantId) as Prisma.EcuFileFindFirstArgs,
        ),
    },
  };
}

export async function confirmEcuFileUploadTransactional(
  prisma: PrismaClient,
  tenantId: string,
  storage: Pick<EcuFileStoragePort, "readObjectSha256">,
  params: ConfirmEcuFileUploadParams,
) {
  try {
    return await prisma.$transaction(async (tx) => {
      const db = buildTransactionalDb(tx, tenantId);
      return confirmEcuFileUpload({ db, storage }, params);
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === UNIQUE_VIOLATION_CODE) {
      const existing = await prisma.ecuFile.findFirst({
        where: { tenantId, vehicleId: params.vehicleId, checksum: params.claimedChecksum },
      });
      throw new DuplicateEcuFileError(existing?.id ?? "bilinmiyor (eşzamanlı yazım)");
    }
    throw error;
  }
}
