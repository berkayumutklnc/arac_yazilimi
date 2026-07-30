import { Role } from "../../generated/prisma/enums.js";
import type { EcuFileType } from "../../generated/prisma/enums.js";
import { DealerAccountNotFoundError, type ActingUser } from "./fileRequest.service.js";
import type { FileRequestStatus } from "./fileRequestStatus.machine.js";

// FileRequest/DealerAccount bilinçli olarak tenant-scope extension'ın DIŞINDA
// (bkz. ADR 0006) — bu servisler her zaman ham (unscoped) prisma model
// delegate'leriyle çağrılır, yetkilendirme burada elle yapılır.

export interface FileRequestListItem {
  id: string;
  hubTenantId: string;
  dealerTenantId: string;
  vehicleId: string;
  requestedStage: EcuFileType;
  status: FileRequestStatus;
  costKurus: number | null;
  resultFileId: string | null;
  requestedBy: string;
  processedBy: string | null;
  createdAt: Date;
}

export interface FileRequestListDb {
  fileRequest: {
    findMany: (args: {
      where: { hubTenantId: string } | { dealerTenantId: string };
    }) => Promise<FileRequestListItem[]>;
  };
}

// Rol-duyarlı: DEALER kendi açtığı talepleri (dealerTenantId), OWNER/ENGINEER
// kendi merkezine gelen talepleri (hubTenantId) görür — asla ikisi birden ve
// asla başka bir tenant'ınki değil.
export async function listFileRequests(
  db: FileRequestListDb,
  actingUser: ActingUser,
): Promise<FileRequestListItem[]> {
  const where =
    actingUser.role === Role.DEALER
      ? { dealerTenantId: actingUser.tenantId }
      : { hubTenantId: actingUser.tenantId };
  return db.fileRequest.findMany({ where });
}

export interface DealerAccountBalanceDb {
  dealerAccount: {
    findFirst: (args: {
      where: { hubTenantId: string; dealerTenantId: string };
    }) => Promise<{ id: string; creditBalanceKurus: number } | null>;
  };
}

export interface GetDealerAccountBalanceParams {
  hubTenantId: string;
  dealerTenantId: string;
}

export async function getDealerAccountBalance(
  db: DealerAccountBalanceDb,
  params: GetDealerAccountBalanceParams,
): Promise<{ creditBalanceKurus: number }> {
  const account = await db.dealerAccount.findFirst({ where: params });
  if (!account) {
    throw new DealerAccountNotFoundError(params.hubTenantId, params.dealerTenantId);
  }
  return { creditBalanceKurus: account.creditBalanceKurus };
}
