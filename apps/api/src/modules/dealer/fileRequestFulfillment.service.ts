import { Role, type EcuFileType } from "../../generated/prisma/enums.js";
import { createEcuFile, type EcuFileDb } from "../ecufile/ecuFile.service.js";
import { assertValidTransition, type FileRequestStatus } from "./fileRequestStatus.machine.js";
import { ForbiddenRoleError, FileRequestNotFoundError, type ActingUser } from "./fileRequest.service.js";

export class InsufficientCreditError extends Error {
  constructor(availableKurus: number, requiredKurus: number) {
    super(`Yetersiz kredi bakiyesi: mevcut ${availableKurus} kuruş, gereken ${requiredKurus} kuruş.`);
    this.name = "InsufficientCreditError";
  }
}

export class MissingRequestCostError extends Error {
  constructor() {
    super("Talep henüz kabul edilmemiş (costKurus atanmamış), fulfil edilemez.");
    this.name = "MissingRequestCostError";
  }
}

interface FulfillFileRequestRecord {
  id: string;
  hubTenantId: string;
  dealerTenantId: string;
  dealerAccountId: string;
  vehicleId: string;
  readFileId: string;
  requestedStage: EcuFileType;
  status: FileRequestStatus;
  costKurus: number | null;
}

interface DealerAccountBalance {
  id: string;
  creditBalanceKurus: number;
}

interface FileRequestFulfillUpdateData {
  status: "FULFILLED";
  resultFileId: string;
  processedBy: string;
}

interface FileRequestAuditData {
  fileRequestId: string;
  hubTenantId: string;
  dealerTenantId: string;
  fromStatus: FileRequestStatus;
  toStatus: FileRequestStatus;
  changedBy: string;
}

// DealerAccount/FileRequest/FileRequestStatusAuditLog/DealerCreditTransaction
// bilinçli olarak tenant-scope extension'ın DIŞINDA (ADR 0006, Model Kapsamı
// Tablosu) — hangi tenant'a scoped bir istemciyle çağrılırsa çağrılsın bu
// modeller için davranış aynıdır (extension bunlara hiç dokunmaz).
export interface FulfillFileRequestDb {
  fileRequest: {
    findUnique: (args: { where: { id: string } }) => Promise<FulfillFileRequestRecord | null>;
    update: (args: {
      where: { id: string };
      data: FileRequestFulfillUpdateData;
    }) => Promise<unknown>;
  };
  dealerAccount: {
    findUnique: (args: { where: { id: string } }) => Promise<DealerAccountBalance | null>;
    update: (args: {
      where: { id: string };
      data: { creditBalanceKurus: number };
    }) => Promise<unknown>;
  };
  dealerCreditTransaction: {
    create: (args: {
      data: {
        dealerAccountId: string;
        amountKurus: number;
        balanceAfterKurus: number;
        fileRequestId: string;
      };
    }) => Promise<unknown>;
  };
  fileRequestStatusAuditLog: {
    create: (args: { data: FileRequestAuditData }) => Promise<unknown>;
  };
}

const HUB_ALLOWED_ROLES: readonly Role[] = [Role.OWNER, Role.ENGINEER];

export interface FulfillFileRequestParams {
  fileRequestId: string;
  hubTenantId: string;
  actingUser: ActingUser;
  storageKey: string;
  checksum: string;
}

export interface FulfillFileRequestDeps {
  db: FulfillFileRequestDb;
  // Kalibre dosya DEALER'ın tenant'ında oluşturulmalı (ADR 0002/0005), ama
  // referans verdiği Vehicle HER ZAMAN hub'ın tenant'ında yaşar — bu yüzden
  // iki AYRI tenant scope'u gerekiyor (bkz. fileRequestFulfillmentTransactional.ts
  // buildScopedEcuFileDb). Bu fonksiyonu tetikleyen hub kullanıcısının
  // request-scoped db'si HUB'ın tenant'ına scoped, ama dealer'ın tenant'ı
  // ancak fileRequest kaydı okunduktan SONRA bilinir — bu yüzden EcuFile/
  // Vehicle erişimi için ayrı, sonradan (fetch edilen hubTenantId +
  // dealerTenantId ile) scoped bir görünüm isteniyor.
  scopeEcuFileToDealerTenant: (hubTenantId: string, dealerTenantId: string) => EcuFileDb;
}

export async function fulfillFileRequest(
  deps: FulfillFileRequestDeps,
  params: FulfillFileRequestParams,
) {
  const isHubUser =
    HUB_ALLOWED_ROLES.includes(params.actingUser.role) &&
    params.actingUser.tenantId === params.hubTenantId;
  if (!isHubUser) {
    throw new ForbiddenRoleError(
      `Rol "${params.actingUser.role}" bu talebi fulfil edemez; yalnızca merkez tenant'ın OWNER/ENGINEER kullanıcıları yetkilidir.`,
    );
  }

  const fileRequest = await deps.db.fileRequest.findUnique({ where: { id: params.fileRequestId } });
  if (!fileRequest || fileRequest.hubTenantId !== params.hubTenantId) {
    throw new FileRequestNotFoundError(params.fileRequestId);
  }

  assertValidTransition(fileRequest.status, "FULFILLED");

  if (fileRequest.costKurus === null) {
    throw new MissingRequestCostError();
  }
  const costKurus = fileRequest.costKurus;

  const dealerAccount = await deps.db.dealerAccount.findUnique({
    where: { id: fileRequest.dealerAccountId },
  });
  if (!dealerAccount) {
    throw new FileRequestNotFoundError(params.fileRequestId);
  }

  const balanceAfter = dealerAccount.creditBalanceKurus - costKurus;
  if (balanceAfter < 0) {
    throw new InsufficientCreditError(dealerAccount.creditBalanceKurus, costKurus);
  }

  const dealerEcuFileDb = deps.scopeEcuFileToDealerTenant(fileRequest.hubTenantId, fileRequest.dealerTenantId);
  const resultFile = await createEcuFile(dealerEcuFileDb, {
    vehicleId: fileRequest.vehicleId,
    fileType: fileRequest.requestedStage,
    storageKey: params.storageKey,
    checksum: params.checksum,
    uploadedBy: params.actingUser.id,
    stockRomRef: fileRequest.readFileId,
  });

  await deps.db.dealerAccount.update({
    where: { id: dealerAccount.id },
    data: { creditBalanceKurus: balanceAfter },
  });

  await deps.db.dealerCreditTransaction.create({
    data: {
      dealerAccountId: dealerAccount.id,
      amountKurus: -costKurus,
      balanceAfterKurus: balanceAfter,
      fileRequestId: fileRequest.id,
    },
  });

  await deps.db.fileRequest.update({
    where: { id: fileRequest.id },
    data: {
      status: "FULFILLED",
      resultFileId: resultFile.id,
      processedBy: params.actingUser.id,
    },
  });

  await deps.db.fileRequestStatusAuditLog.create({
    data: {
      fileRequestId: fileRequest.id,
      hubTenantId: fileRequest.hubTenantId,
      dealerTenantId: fileRequest.dealerTenantId,
      fromStatus: fileRequest.status,
      toStatus: "FULFILLED",
      changedBy: params.actingUser.id,
    },
  });

  return resultFile;
}
