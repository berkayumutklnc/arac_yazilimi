import { describe, expect, it, vi } from "vitest";
import {
  proposeDealerLink,
  respondToDealerLink,
  listDealerLinks,
  ForbiddenDealerLinkActionError,
  DealerTenantNotFoundError,
  DealerLinkAlreadyExistsError,
  DealerLinkNotFoundError,
  ConcurrentDealerLinkResponseError,
  type DealerLinkDb,
  type ActingUser,
} from "./dealerLink.service.js";
import { Role } from "../../generated/prisma/enums.js";

const hubTenantId = "hub-1";
const dealerTenantId = "dealer-1";
const hubOwner: ActingUser = { id: "hub-owner-1", tenantId: hubTenantId, role: Role.OWNER };
const dealerOwner: ActingUser = { id: "dealer-owner-1", tenantId: dealerTenantId, role: Role.OWNER };

function createMockDb() {
  const tenantFindUnique = vi.fn<DealerLinkDb["tenant"]["findUnique"]>();
  const dealerAccountFindFirst = vi.fn<DealerLinkDb["dealerAccount"]["findFirst"]>();
  const dealerAccountCreate = vi.fn<DealerLinkDb["dealerAccount"]["create"]>();
  const dealerAccountFindUnique = vi.fn<DealerLinkDb["dealerAccount"]["findUnique"]>();
  const dealerAccountUpdateMany = vi.fn<DealerLinkDb["dealerAccount"]["updateMany"]>();
  const dealerAccountFindMany = vi.fn<DealerLinkDb["dealerAccount"]["findMany"]>();
  const db: DealerLinkDb = {
    tenant: { findUnique: tenantFindUnique },
    dealerAccount: {
      findFirst: dealerAccountFindFirst,
      create: dealerAccountCreate,
      findUnique: dealerAccountFindUnique,
      updateMany: dealerAccountUpdateMany,
      findMany: dealerAccountFindMany,
    },
  };
  return {
    db,
    tenantFindUnique,
    dealerAccountFindFirst,
    dealerAccountCreate,
    dealerAccountFindUnique,
    dealerAccountUpdateMany,
    dealerAccountFindMany,
  };
}

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "link-1",
    hubTenantId,
    dealerTenantId,
    status: "PENDING" as const,
    requestedBy: hubOwner.id,
    approvedBy: null,
    respondedAt: null,
    creditBalanceKurus: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

describe("proposeDealerLink", () => {
  it("OWNER olmayan bir rol ForbiddenDealerLinkActionError alır", async () => {
    const { db } = createMockDb();
    const engineer: ActingUser = { id: "eng-1", tenantId: hubTenantId, role: Role.ENGINEER };

    await expect(
      proposeDealerLink(db, engineer, { dealerTenantSlug: "dealer-slug" }),
    ).rejects.toBeInstanceOf(ForbiddenDealerLinkActionError);
  });

  it("bilinmeyen dealerTenantSlug için DealerTenantNotFoundError fırlatır", async () => {
    const { db, tenantFindUnique } = createMockDb();
    tenantFindUnique.mockResolvedValue(null);

    await expect(
      proposeDealerLink(db, hubOwner, { dealerTenantSlug: "unknown" }),
    ).rejects.toBeInstanceOf(DealerTenantNotFoundError);
  });

  it("bu hub+dealer çifti için zaten bir kayıt varsa (durumu ne olursa olsun) DealerLinkAlreadyExistsError fırlatır", async () => {
    const { db, tenantFindUnique, dealerAccountFindFirst, dealerAccountCreate } = createMockDb();
    tenantFindUnique.mockResolvedValue({ id: dealerTenantId });
    dealerAccountFindFirst.mockResolvedValue({ id: "existing-link" });

    await expect(
      proposeDealerLink(db, hubOwner, { dealerTenantSlug: "dealer-slug" }),
    ).rejects.toBeInstanceOf(DealerLinkAlreadyExistsError);
    expect(dealerAccountCreate).not.toHaveBeenCalled();
  });

  it("geçerli girdiyle PENDING durumunda bir bağlantı önerisi oluşturur", async () => {
    const { db, tenantFindUnique, dealerAccountFindFirst, dealerAccountCreate } = createMockDb();
    tenantFindUnique.mockResolvedValue({ id: dealerTenantId });
    dealerAccountFindFirst.mockResolvedValue(null);
    dealerAccountCreate.mockResolvedValue(linkRow());

    await proposeDealerLink(db, hubOwner, { dealerTenantSlug: "dealer-slug" });

    expect(dealerAccountCreate).toHaveBeenCalledWith({
      data: { hubTenantId, dealerTenantId, requestedBy: hubOwner.id },
    });
  });
});

describe("respondToDealerLink", () => {
  it("OWNER olmayan bir rol ForbiddenDealerLinkActionError alır", async () => {
    const { db } = createMockDb();
    const engineer: ActingUser = { id: "eng-1", tenantId: dealerTenantId, role: Role.ENGINEER };

    await expect(respondToDealerLink(db, engineer, "link-1", true)).rejects.toBeInstanceOf(
      ForbiddenDealerLinkActionError,
    );
  });

  it("hub OWNER'ı kendi önerdiği bağlantıyı onaylayamaz/reddedemez (DealerLinkNotFoundError — bulunamamış gibi davranır)", async () => {
    const { db, dealerAccountFindUnique } = createMockDb();
    dealerAccountFindUnique.mockResolvedValue(linkRow());

    await expect(respondToDealerLink(db, hubOwner, "link-1", true)).rejects.toBeInstanceOf(
      DealerLinkNotFoundError,
    );
  });

  it("var olmayan bir bağlantı için DealerLinkNotFoundError fırlatır", async () => {
    const { db, dealerAccountFindUnique } = createMockDb();
    dealerAccountFindUnique.mockResolvedValue(null);

    await expect(respondToDealerLink(db, dealerOwner, "link-1", true)).rejects.toBeInstanceOf(
      DealerLinkNotFoundError,
    );
  });

  it("dealer OWNER'ı onaylarsa status=ACTIVE olarak günceller", async () => {
    const { db, dealerAccountFindUnique, dealerAccountUpdateMany } = createMockDb();
    dealerAccountFindUnique.mockResolvedValue(linkRow());
    dealerAccountUpdateMany.mockResolvedValue({ count: 1 });

    await respondToDealerLink(db, dealerOwner, "link-1", true);

    expect(dealerAccountUpdateMany).toHaveBeenCalledWith({
      where: { id: "link-1", status: "PENDING" },
      data: { status: "ACTIVE", approvedBy: dealerOwner.id, respondedAt: expect.any(Date) as Date },
    });
  });

  it("dealer OWNER'ı reddederse status=REJECTED olarak günceller", async () => {
    const { db, dealerAccountFindUnique, dealerAccountUpdateMany } = createMockDb();
    dealerAccountFindUnique.mockResolvedValue(linkRow());
    dealerAccountUpdateMany.mockResolvedValue({ count: 1 });

    await respondToDealerLink(db, dealerOwner, "link-1", false);

    expect(dealerAccountUpdateMany).toHaveBeenCalledWith({
      where: { id: "link-1", status: "PENDING" },
      data: { status: "REJECTED", approvedBy: dealerOwner.id, respondedAt: expect.any(Date) as Date },
    });
  });

  it("eşzamanlı iki yanıttan ikincisi (updateMany 0 satır etkiler) ConcurrentDealerLinkResponseError fırlatır", async () => {
    const { db, dealerAccountFindUnique, dealerAccountUpdateMany } = createMockDb();
    dealerAccountFindUnique.mockResolvedValue(linkRow());
    dealerAccountUpdateMany.mockResolvedValue({ count: 0 });

    await expect(respondToDealerLink(db, dealerOwner, "link-1", true)).rejects.toBeInstanceOf(
      ConcurrentDealerLinkResponseError,
    );
  });
});

describe("listDealerLinks", () => {
  it("hub veya dealer tarafı olduğu tüm bağlantıları listeler", async () => {
    const { db, dealerAccountFindMany } = createMockDb();
    dealerAccountFindMany.mockResolvedValue([]);

    await listDealerLinks(db, hubOwner);

    expect(dealerAccountFindMany).toHaveBeenCalledWith({
      where: { OR: [{ hubTenantId: hubTenantId }, { dealerTenantId: hubTenantId }] },
      orderBy: { createdAt: "desc" },
    });
  });
});
