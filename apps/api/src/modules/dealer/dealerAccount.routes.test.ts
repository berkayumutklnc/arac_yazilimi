import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerDealerAccountRoutes } from "./dealerAccount.routes.js";
import { signAccessToken } from "../auth/authToken.js";
import { Role } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

const jwtSecret = "test-secret";
const hubTenantId = "hub-1";
const dealerTenantId = "dealer-1";
const dealerAccountId = "acct-1";

function authHeader(overrides: { role?: Role; tenantId?: string; userId?: string } = {}) {
  const token = signAccessToken(
    { userId: overrides.userId ?? "actor-1", tenantId: overrides.tenantId ?? hubTenantId, role: overrides.role ?? Role.OWNER },
    jwtSecret,
  );
  return { authorization: `Bearer ${token}` };
}

function linkRow(overrides: Record<string, unknown> = {}) {
  return {
    id: dealerAccountId,
    hubTenantId,
    dealerTenantId,
    status: "PENDING",
    requestedBy: "actor-1",
    approvedBy: null,
    respondedAt: null,
    creditBalanceKurus: 0,
    createdAt: new Date(),
    ...overrides,
  };
}

function createFakePrisma(overrides: {
  tenantFindUnique?: ReturnType<typeof vi.fn>;
  dealerAccountFindFirst?: ReturnType<typeof vi.fn>;
  dealerAccountCreate?: ReturnType<typeof vi.fn>;
  dealerAccountFindUnique?: ReturnType<typeof vi.fn>;
  dealerAccountUpdateMany?: ReturnType<typeof vi.fn>;
  dealerAccountFindMany?: ReturnType<typeof vi.fn>;
  queryRaw?: ReturnType<typeof vi.fn>;
  dealerAccountUpdate?: ReturnType<typeof vi.fn>;
  dealerCreditTransactionCreate?: ReturnType<typeof vi.fn>;
} = {}) {
  const tenantFindUnique = overrides.tenantFindUnique ?? vi.fn().mockResolvedValue({ id: dealerTenantId });
  const dealerAccountFindFirst = overrides.dealerAccountFindFirst ?? vi.fn().mockResolvedValue(null);
  const dealerAccountCreate = overrides.dealerAccountCreate ?? vi.fn().mockResolvedValue(linkRow());
  const dealerAccountFindUnique = overrides.dealerAccountFindUnique ?? vi.fn().mockResolvedValue(linkRow());
  const dealerAccountUpdateMany = overrides.dealerAccountUpdateMany ?? vi.fn().mockResolvedValue({ count: 1 });
  const dealerAccountFindMany = overrides.dealerAccountFindMany ?? vi.fn().mockResolvedValue([]);
  const queryRaw =
    overrides.queryRaw ??
    vi.fn().mockResolvedValue([{ id: dealerAccountId, hubTenantId, dealerTenantId, status: "ACTIVE", creditBalanceKurus: 1000 }]);
  const dealerAccountUpdate = overrides.dealerAccountUpdate ?? vi.fn().mockResolvedValue({});
  const dealerCreditTransactionCreate = overrides.dealerCreditTransactionCreate ?? vi.fn().mockResolvedValue({});

  const $transaction = vi.fn((fn: (tx: unknown) => unknown) =>
    fn({
      $queryRaw: queryRaw,
      dealerAccount: { update: dealerAccountUpdate },
      dealerCreditTransaction: { create: dealerCreditTransactionCreate },
    }),
  );

  const prisma = {
    $extends: () => ({}),
    tenant: { findUnique: tenantFindUnique },
    dealerAccount: {
      findFirst: dealerAccountFindFirst,
      create: dealerAccountCreate,
      findUnique: dealerAccountFindUnique,
      updateMany: dealerAccountUpdateMany,
      findMany: dealerAccountFindMany,
    },
    $transaction,
  } as unknown as PrismaClient;

  return {
    prisma,
    tenantFindUnique,
    dealerAccountFindFirst,
    dealerAccountCreate,
    dealerAccountFindUnique,
    dealerAccountUpdateMany,
    dealerAccountFindMany,
    queryRaw,
    dealerAccountUpdate,
  };
}

function buildTestApp(prisma: PrismaClient) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Geçersiz istek gövdesi", issues: error.issues });
    }
    return reply.send(error);
  });
  registerDealerAccountRoutes(app, prisma, jwtSecret);
  return app;
}

describe("POST /dealer/links", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/dealer/links",
      payload: { dealerTenantSlug: "dealer-slug" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("OWNER olmayan bir rol 403 alır", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/dealer/links",
      headers: authHeader({ role: Role.ENGINEER }),
      payload: { dealerTenantSlug: "dealer-slug" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("geçerli girdiyle 201 döner", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/dealer/links",
      headers: authHeader(),
      payload: { dealerTenantSlug: "dealer-slug" },
    });

    expect(response.statusCode).toBe(201);
  });

  it("zaten var olan bir bağlantı için 409 döner", async () => {
    const { prisma } = createFakePrisma({ dealerAccountFindFirst: vi.fn().mockResolvedValue({ id: "existing" }) });
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/dealer/links",
      headers: authHeader(),
      payload: { dealerTenantSlug: "dealer-slug" },
    });

    expect(response.statusCode).toBe(409);
  });
});

describe("POST /dealer/links/:id/respond", () => {
  it("hub OWNER'ı kendi önerdiği bağlantıyı yanıtlayamaz — 404 döner", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: `/dealer/links/${dealerAccountId}/respond`,
      headers: authHeader({ tenantId: hubTenantId }),
      payload: { approve: true },
    });

    expect(response.statusCode).toBe(404);
  });

  it("dealer OWNER'ı onaylarsa 200 döner", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: `/dealer/links/${dealerAccountId}/respond`,
      headers: authHeader({ tenantId: dealerTenantId }),
      payload: { approve: true },
    });

    expect(response.statusCode).toBe(200);
  });
});

describe("GET /dealer/links", () => {
  it("OWNER hub veya dealer tarafı bağlantıları 200 ile alır", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({ method: "GET", url: "/dealer/links", headers: authHeader() });

    expect(response.statusCode).toBe(200);
  });
});

describe("POST /dealer/accounts/:id/credit-topup", () => {
  it("hub OWNER'ı olmayan (dealer OWNER'ı) 404 alır", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: `/dealer/accounts/${dealerAccountId}/credit-topup`,
      headers: authHeader({ tenantId: dealerTenantId }),
      payload: { amountKurus: 5000 },
    });

    expect(response.statusCode).toBe(404);
  });

  it("sıfır veya negatif tutar 400 döner", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: `/dealer/accounts/${dealerAccountId}/credit-topup`,
      headers: authHeader({ tenantId: hubTenantId }),
      payload: { amountKurus: 0 },
    });

    expect(response.statusCode).toBe(400);
  });

  it("geçerli hub OWNER top-up'ı 200 döner", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: `/dealer/accounts/${dealerAccountId}/credit-topup`,
      headers: authHeader({ tenantId: hubTenantId }),
      payload: { amountKurus: 5000 },
    });

    expect(response.statusCode).toBe(200);
    const body: { balanceAfterKurus: number } = response.json();
    expect(body.balanceAfterKurus).toBe(6000);
  });
});
