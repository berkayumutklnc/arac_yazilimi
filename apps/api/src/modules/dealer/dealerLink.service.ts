import { Role, type DealerAccountStatus } from "../../generated/prisma/enums.js";

export class ForbiddenDealerLinkActionError extends Error {
  constructor() {
    super("Bu işlemi yalnızca OWNER rolündeki kullanıcılar yapabilir.");
    this.name = "ForbiddenDealerLinkActionError";
  }
}

export class DealerTenantNotFoundError extends Error {
  constructor(slug: string) {
    super(`Bayi tenant'ı bulunamadı: ${slug}`);
    this.name = "DealerTenantNotFoundError";
  }
}

export class DealerLinkAlreadyExistsError extends Error {
  constructor() {
    super("Bu hub-bayi çifti için zaten bir bağlantı kaydı var (durumu ne olursa olsun).");
    this.name = "DealerLinkAlreadyExistsError";
  }
}

// bkz. ADR 0013 — hub OWNER'ının kendi önerdiği bağlantıyı yanıtlamaya
// çalışması da (aksi durumda erişemeyeceği başka bir tenant kaynağıyla aynı
// şekilde) bu hatayla sonuçlanır — ayrı bir 403 yerine "yokmuş gibi" 404.
export class DealerLinkNotFoundError extends Error {
  constructor(dealerAccountId: string) {
    super(`Bayi bağlantısı bulunamadı: ${dealerAccountId}`);
    this.name = "DealerLinkNotFoundError";
  }
}

export class ConcurrentDealerLinkResponseError extends Error {
  constructor(dealerAccountId: string) {
    super(`Bağlantı ${dealerAccountId} bu işlem sürerken başka bir yanıtla zaten sonuçlandırılmış.`);
    this.name = "ConcurrentDealerLinkResponseError";
  }
}

interface DealerLinkRecord {
  id: string;
  hubTenantId: string;
  dealerTenantId: string;
  status: DealerAccountStatus;
  requestedBy: string;
  approvedBy: string | null;
  respondedAt: Date | null;
  creditBalanceKurus: number;
  createdAt: Date;
}

export interface DealerLinkDb {
  tenant: {
    findUnique: (args: { where: { slug: string } }) => Promise<{ id: string } | null>;
  };
  dealerAccount: {
    findFirst: (args: {
      where: { hubTenantId: string; dealerTenantId: string };
    }) => Promise<{ id: string } | null>;
    create: (args: {
      data: { hubTenantId: string; dealerTenantId: string; requestedBy: string };
    }) => Promise<DealerLinkRecord>;
    findUnique: (args: { where: { id: string } }) => Promise<DealerLinkRecord | null>;
    updateMany: (args: {
      where: { id: string; status: "PENDING" };
      data: { status: "ACTIVE" | "REJECTED"; approvedBy: string; respondedAt: Date };
    }) => Promise<{ count: number }>;
    findMany: (args: {
      where: { OR: [{ hubTenantId: string }, { dealerTenantId: string }] };
      orderBy: { createdAt: "desc" };
    }) => Promise<DealerLinkRecord[]>;
  };
}

export interface ActingUser {
  id: string;
  tenantId: string;
  role: Role;
}

export interface ProposeDealerLinkParams {
  dealerTenantSlug: string;
}

export async function proposeDealerLink(
  db: DealerLinkDb,
  actingUser: ActingUser,
  params: ProposeDealerLinkParams,
): Promise<DealerLinkRecord> {
  if (actingUser.role !== Role.OWNER) {
    throw new ForbiddenDealerLinkActionError();
  }

  const dealerTenant = await db.tenant.findUnique({ where: { slug: params.dealerTenantSlug } });
  if (!dealerTenant) {
    throw new DealerTenantNotFoundError(params.dealerTenantSlug);
  }

  const existing = await db.dealerAccount.findFirst({
    where: { hubTenantId: actingUser.tenantId, dealerTenantId: dealerTenant.id },
  });
  if (existing) {
    throw new DealerLinkAlreadyExistsError();
  }

  return db.dealerAccount.create({
    data: { hubTenantId: actingUser.tenantId, dealerTenantId: dealerTenant.id, requestedBy: actingUser.id },
  });
}

export async function respondToDealerLink(
  db: DealerLinkDb,
  actingUser: ActingUser,
  dealerAccountId: string,
  approve: boolean,
): Promise<void> {
  if (actingUser.role !== Role.OWNER) {
    throw new ForbiddenDealerLinkActionError();
  }

  const link = await db.dealerAccount.findUnique({ where: { id: dealerAccountId } });
  if (!link || link.dealerTenantId !== actingUser.tenantId) {
    throw new DealerLinkNotFoundError(dealerAccountId);
  }

  const result = await db.dealerAccount.updateMany({
    where: { id: dealerAccountId, status: "PENDING" },
    data: {
      status: approve ? "ACTIVE" : "REJECTED",
      approvedBy: actingUser.id,
      respondedAt: new Date(),
    },
  });
  if (result.count === 0) {
    throw new ConcurrentDealerLinkResponseError(dealerAccountId);
  }
}

export async function listDealerLinks(db: DealerLinkDb, actingUser: ActingUser): Promise<DealerLinkRecord[]> {
  return db.dealerAccount.findMany({
    where: { OR: [{ hubTenantId: actingUser.tenantId }, { dealerTenantId: actingUser.tenantId }] },
    orderBy: { createdAt: "desc" },
  });
}
