import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerAdminTenantRoutes } from "./adminTenant.routes.js";
import { signAccessToken } from "../auth/authToken.js";
import { Role } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import { NoopEmailSender } from "../../notifications/emailSender.js";

const jwtSecret = "test-secret";
const webAppBaseUrl = "https://app.example.test";

function authHeader(overrides: { role?: Role; tenantId?: string } = {}) {
  const token = signAccessToken(
    {
      userId: "actor-1",
      tenantId: overrides.tenantId ?? "platform-tenant-1",
      role: overrides.role ?? Role.SUPER_ADMIN,
    },
    jwtSecret,
  );
  return { authorization: `Bearer ${token}` };
}

function createFakePrisma(overrides: {
  tenantFindUnique?: ReturnType<typeof vi.fn>;
  tenantCreate?: ReturnType<typeof vi.fn>;
  tenantFindMany?: ReturnType<typeof vi.fn>;
  invitationCreate?: ReturnType<typeof vi.fn>;
} = {}) {
  const tenantFindUnique = overrides.tenantFindUnique ?? vi.fn().mockResolvedValue(null);
  const tenantCreate =
    overrides.tenantCreate ?? vi.fn().mockResolvedValue({ id: "tenant-1", name: "Acme Atölye", slug: "acme" });
  const tenantFindMany = overrides.tenantFindMany ?? vi.fn().mockResolvedValue([]);
  const invitationCreate =
    overrides.invitationCreate ??
    vi.fn().mockResolvedValue({
      id: "inv-1",
      tenantId: "tenant-1",
      email: "owner@acme.test",
      role: Role.OWNER,
      tokenHash: "irrelevant",
      invitedBy: "actor-1",
      expiresAt: new Date(Date.now() + 1000),
      acceptedAt: null,
      revokedAt: null,
      createdAt: new Date(),
    });

  const prisma = {
    $extends: () => ({}),
    tenant: { findUnique: tenantFindUnique, create: tenantCreate, findMany: tenantFindMany },
    invitation: { create: invitationCreate },
  } as unknown as PrismaClient;

  return { prisma, tenantFindUnique, tenantCreate, tenantFindMany, invitationCreate };
}

function buildTestApp(prisma: PrismaClient) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Geçersiz istek gövdesi", issues: error.issues });
    }
    return reply.send(error);
  });
  registerAdminTenantRoutes(app, prisma, jwtSecret, new NoopEmailSender(), webAppBaseUrl);
  return app;
}

describe("POST /admin/tenants", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/admin/tenants",
      payload: { name: "Acme Atölye", slug: "acme", ownerEmail: "owner@acme.test" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("SUPER_ADMIN olmayan bir rol 403 alır", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/admin/tenants",
      headers: authHeader({ role: Role.OWNER, tenantId: "tenant-1" }),
      payload: { name: "Acme Atölye", slug: "acme", ownerEmail: "owner@acme.test" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("slug zaten kullanılıyorsa 409 döner", async () => {
    const { prisma } = createFakePrisma({ tenantFindUnique: vi.fn().mockResolvedValue({ id: "existing" }) });
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/admin/tenants",
      headers: authHeader(),
      payload: { name: "Acme Atölye", slug: "acme", ownerEmail: "owner@acme.test" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("geçersiz gövde (eksik ownerEmail) için 400 döner", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/admin/tenants",
      headers: authHeader(),
      payload: { name: "Acme Atölye", slug: "acme" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("geçerli girdiyle 201 döner, ham davet token'ı gövdede YOK", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "POST",
      url: "/admin/tenants",
      headers: authHeader(),
      payload: { name: "Acme Atölye", slug: "acme", ownerEmail: "owner@acme.test" },
    });

    expect(response.statusCode).toBe(201);
    const body: { tenant: { id: string } } = response.json();
    expect(body.tenant.id).toBe("tenant-1");
    expect(JSON.stringify(body)).not.toMatch(/rawToken/i);
  });
});

describe("GET /admin/tenants", () => {
  it("SUPER_ADMIN olmayan bir rol 403 alır", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({
      method: "GET",
      url: "/admin/tenants",
      headers: authHeader({ role: Role.OWNER, tenantId: "tenant-1" }),
    });

    expect(response.statusCode).toBe(403);
  });

  it("SUPER_ADMIN tenant listesini 200 ile alır", async () => {
    const { prisma } = createFakePrisma();
    const app = buildTestApp(prisma);

    const response = await app.inject({ method: "GET", url: "/admin/tenants", headers: authHeader() });

    expect(response.statusCode).toBe(200);
  });
});
