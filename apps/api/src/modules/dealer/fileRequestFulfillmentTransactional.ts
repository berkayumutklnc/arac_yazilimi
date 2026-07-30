import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import { applyTenantScope } from "../../db/tenantScopedDb.js";
import {
  fulfillFileRequest,
  type FulfillFileRequestDb,
  type FulfillFileRequestParams,
} from "./fileRequestFulfillment.service.js";
import type { EcuFileDb } from "../ecufile/ecuFile.service.js";
import { lockDealerAccountForUpdate } from "./dealerAccountLock.js";

// bkz. docs/adr/0007-credit-deduction-locking-strategy.md — bu dosya
// `fulfillFileRequest`'in (fileRequestFulfillment.service.ts) saf, fake ile
// test edilmiş iş mantığını DEĞİŞTİRMEZ; yalnızca onun `db`/
// `scopeEcuFileToDealerTenant` bağımlılıklarını gerçek bir `prisma.$transaction`
// üzerinde, satır kilidiyle uygulayan ÜRETİM adaptörünü sağlar.

export class ConcurrentFulfillmentError extends Error {
  constructor(fileRequestId: string) {
    super(
      `Talep ${fileRequestId} bu işlem sürerken başka bir işlemle zaten sonuçlandırılmış (eşzamanlı fulfill çakışması) — bakiye değişmedi.`,
    );
    this.name = "ConcurrentFulfillmentError";
  }
}

// fulfillFileRequest'in saf mantığı `fileRequest.update`'in başarılı
// olacağını varsayar. Üretimde bunun yerine `status = 'IN_PROGRESS'`
// koşuluyla korunan bir `updateMany` kullanılır: aynı talep eşzamanlı iki
// çağrıyla asla iki kez FULFILLED'a taşınamaz (ikinci çağrı 0 satır
// etkiler ve ConcurrentFulfillmentError fırlatır, transaction geri alınır).
function buildTransactionalDb(tx: Prisma.TransactionClient): FulfillFileRequestDb {
  return {
    fileRequest: {
      findUnique: (args) => tx.fileRequest.findUnique(args),
      update: async (args) => {
        const result = await tx.fileRequest.updateMany({
          where: { id: args.where.id, status: "IN_PROGRESS" },
          data: args.data,
        });
        if (result.count === 0) {
          throw new ConcurrentFulfillmentError(args.where.id);
        }
        return result;
      },
    },
    dealerAccount: {
      findUnique: (args) => lockDealerAccountForUpdate(tx, args.where.id),
      update: (args) => tx.dealerAccount.update(args),
    },
    dealerCreditTransaction: {
      create: (args) => tx.dealerCreditTransaction.create(args),
    },
    fileRequestStatusAuditLog: {
      create: (args) => tx.fileRequestStatusAuditLog.create(args),
    },
  };
}

// Kalibre dosya DEALER'ın tenant'ında oluşturulmalı (bkz.
// fileRequestFulfillment.service.ts). Tenant kapsamlaması burada `tx` üzerinde
// elle uygulanıyor (aynı test edilmiş `applyTenantScope` saf fonksiyonuyla) —
// `createTenantScopedDb`'nin `$extends()` tabanlı üretim client'ı yerine, bu
// atomik işlem TAMAMEN aynı transaction (`tx`) içinde kalsın diye.
function buildScopedEcuFileDb(tx: Prisma.TransactionClient, dealerTenantId: string): EcuFileDb {
  return {
    vehicle: {
      findUnique: (args) =>
        tx.vehicle.findUnique(
          applyTenantScope("Vehicle", "findUnique", args, dealerTenantId) as Prisma.VehicleFindUniqueArgs,
        ),
    },
    ecuFile: {
      create: (args) =>
        tx.ecuFile.create(
          applyTenantScope("EcuFile", "create", args, dealerTenantId) as Prisma.EcuFileCreateArgs,
        ),
      findUnique: (args) =>
        tx.ecuFile.findUnique(
          applyTenantScope(
            "EcuFile",
            "findUnique",
            args,
            dealerTenantId,
          ) as Prisma.EcuFileFindUniqueArgs,
        ),
    },
  };
}

export async function fulfillFileRequestTransactional(
  prisma: PrismaClient,
  params: FulfillFileRequestParams,
) {
  return prisma.$transaction(async (tx) => {
    const db = buildTransactionalDb(tx);
    const scopeEcuFileToDealerTenant = (dealerTenantId: string) =>
      buildScopedEcuFileDb(tx, dealerTenantId);
    return fulfillFileRequest({ db, scopeEcuFileToDealerTenant }, params);
  });
}
