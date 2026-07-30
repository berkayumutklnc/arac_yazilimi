import { describe, expect, it, vi } from "vitest";
import {
  listFileRequests,
  getDealerAccountBalance,
  type FileRequestListDb,
  type DealerAccountBalanceDb,
} from "./fileRequestQuery.service.js";
import { DealerAccountNotFoundError } from "./fileRequest.service.js";
import { Role, EcuFileType } from "../../generated/prisma/enums.js";

const hubTenantId = "hub-1";
const dealerTenantId = "dealer-1";

describe("listFileRequests", () => {
  it("DEALER rolü kendi açtığı talepleri (dealerTenantId filtresiyle) görür", async () => {
    const findMany = vi.fn<FileRequestListDb["fileRequest"]["findMany"]>();
    findMany.mockResolvedValue([]);
    const db: FileRequestListDb = { fileRequest: { findMany } };
    const dealerUser = { id: "u-1", tenantId: dealerTenantId, role: Role.DEALER };

    await listFileRequests(db, dealerUser);

    expect(findMany).toHaveBeenCalledWith({ where: { dealerTenantId } });
  });

  it("OWNER/ENGINEER kendi merkezine gelen talepleri (hubTenantId filtresiyle) görür", async () => {
    const findMany = vi.fn<FileRequestListDb["fileRequest"]["findMany"]>();
    findMany.mockResolvedValue([]);
    const db: FileRequestListDb = { fileRequest: { findMany } };
    const hubUser = { id: "u-2", tenantId: hubTenantId, role: Role.ENGINEER };

    await listFileRequests(db, hubUser);

    expect(findMany).toHaveBeenCalledWith({ where: { hubTenantId } });
  });

  it("bulunan talepleri olduğu gibi döner", async () => {
    const findMany = vi.fn<FileRequestListDb["fileRequest"]["findMany"]>();
    findMany.mockResolvedValue([
      {
        id: "req-1",
        hubTenantId,
        dealerTenantId,
        vehicleId: "vehicle-1",
        requestedStage: EcuFileType.STAGE1,
        status: "PENDING",
        costKurus: null,
        resultFileId: null,
        requestedBy: "u-1",
        processedBy: null,
        createdAt: new Date("2026-01-01"),
      },
    ]);
    const db: FileRequestListDb = { fileRequest: { findMany } };

    const result = await listFileRequests(db, { id: "u-1", tenantId: dealerTenantId, role: Role.DEALER });

    expect(result).toHaveLength(1);
  });
});

describe("getDealerAccountBalance", () => {
  it("hesap yoksa DealerAccountNotFoundError fırlatır", async () => {
    const findFirst = vi.fn<DealerAccountBalanceDb["dealerAccount"]["findFirst"]>();
    findFirst.mockResolvedValue(null);
    const db: DealerAccountBalanceDb = { dealerAccount: { findFirst } };

    await expect(getDealerAccountBalance(db, { hubTenantId, dealerTenantId })).rejects.toBeInstanceOf(
      DealerAccountNotFoundError,
    );
  });

  it("hesap varsa yalnızca bakiyeyi döner", async () => {
    const findFirst = vi.fn<DealerAccountBalanceDb["dealerAccount"]["findFirst"]>();
    findFirst.mockResolvedValue({ id: "acct-1", creditBalanceKurus: 15000 });
    const db: DealerAccountBalanceDb = { dealerAccount: { findFirst } };

    const result = await getDealerAccountBalance(db, { hubTenantId, dealerTenantId });

    expect(result).toEqual({ creditBalanceKurus: 15000 });
    expect(findFirst).toHaveBeenCalledWith({ where: { hubTenantId, dealerTenantId } });
  });
});
