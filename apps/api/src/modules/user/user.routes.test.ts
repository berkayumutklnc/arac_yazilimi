import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerUserRoutes } from "./user.routes.js";
import { signAccessToken } from "../auth/authToken.js";
import { Role } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { AppScopedDb } from "../../db/tenantScopedDb.js";
import { NoopEmailSender } from "../../notifications/emailSender.js";

const jwtSecret = "test-secret";
const tenantId = "tenant-1";
const webAppBaseUrl = "https://app.example.test";

function authHeader(overrides: { role?: Role; tenantId?: string; userId?: string } = {}) {
  const token = signAccessToken(
    {
      userId: overrides.userId ?? "owner-1",
      tenantId: overrides.tenantId ?? tenantId,
      role: overrides.role ?? Role.OWNER,
    },
    jwtSecret,
  );
  return { authorization: `Bearer ${token}` };
}

function createMockScopedDb() {
  const invitationCreate = vi.fn<AppScopedDb["invitation"]["create"]>();
  invitationCreate.mockResolvedValue({
    id: "inv-1",
    tenantId,
    email: "new@acme.test",
    role: Role.ENGINEER,
    tokenHash: "irrelevant",
    invitedBy: "owner-1",
    expiresAt: new Date(Date.now() + 1000),
    acceptedAt: null,
    revokedAt: null,
    createdAt: new Date(),
  });
  const invitationFindMany = vi.fn<AppScopedDb["invitation"]["findMany"]>();
  invitationFindMany.mockResolvedValue([]);
  const userFindMany = vi.fn<AppScopedDb["user"]["findMany"]>();
  userFindMany.mockResolvedValue([]);

  const scopedDb = {
    invitation: { create: invitationCreate, findMany: invitationFindMany },
    user: { findMany: userFindMany },
  } as unknown as AppScopedDb;

  return { scopedDb, invitationCreate, invitationFindMany, userFindMany };
}

function createFakeTx(overrides: { targetRow?: Record<string, unknown> | null; ownerCount?: number } = {}) {
  const userFindUnique = vi.fn().mockResolvedValue(
    overrides.targetRow === undefined
      ? { id: "user-2", tenantId, role: Role.ENGINEER, deactivatedAt: null }
      : overrides.targetRow,
  );
  const userUpdate = vi.fn().mockResolvedValue({});
  const userCount = vi.fn().mockResolvedValue(overrides.ownerCount ?? 2);
  const auditCreate = vi.fn().mockResolvedValue({});
  const refreshTokenUpdateMany = vi.fn().mockResolvedValue({});
  const tx = {
    user: { findUnique: userFindUnique, update: userUpdate, count: userCount },
    userManagementAuditLog: { create: auditCreate },
    refreshToken: { updateMany: refreshTokenUpdateMany },
  };
  return { tx, userFindUnique, userUpdate };
}

function buildTestApp(scopedDb: AppScopedDb, tx: unknown = createFakeTx().tx) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Geçersiz istek gövdesi", issues: error.issues });
    }
    return reply.send(error);
  });

  const $transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(tx));
  const prisma = { $extends: () => scopedDb, $transaction } as unknown as PrismaClient;

  registerUserRoutes(app, prisma, jwtSecret, new NoopEmailSender(), webAppBaseUrl);
  return app;
}

describe("POST /tenant/users/invite", () => {
  it("Authorization başlığı yoksa 401 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/tenant/users/invite",
      payload: { email: "new@acme.test", role: "ENGINEER" },
    });

    expect(response.statusCode).toBe(401);
  });

  it("OWNER olmayan bir rol 403 alır", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/tenant/users/invite",
      headers: authHeader({ role: Role.ENGINEER }),
      payload: { email: "new@acme.test", role: "ENGINEER" },
    });

    expect(response.statusCode).toBe(403);
  });

  it("SUPER_ADMIN rolüyle davet isteği 400 döner (zod reddeder)", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/tenant/users/invite",
      headers: authHeader(),
      payload: { email: "new@acme.test", role: "SUPER_ADMIN" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("OWNER dahil geçerli bir rolle 201 döner (çok-OWNER'lı tenant desteklenir)", async () => {
    const { scopedDb, invitationCreate } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({
      method: "POST",
      url: "/tenant/users/invite",
      headers: authHeader(),
      payload: { email: "new-owner@acme.test", role: "OWNER" },
    });

    expect(response.statusCode).toBe(201);
    const invitationArgs = invitationCreate.mock.calls[0]?.[0];
    expect(invitationArgs?.data.role).toBe("OWNER");
    expect(invitationArgs?.data.invitedBy).toBe("owner-1");
    expect(JSON.stringify(response.json())).not.toMatch(/rawToken/i);
  });
});

describe("GET /tenant/users ve GET /tenant/invitations", () => {
  it("OWNER olmayan bir rol 403 alır", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: "/tenant/users", headers: authHeader({ role: Role.DEALER }) });

    expect(response.statusCode).toBe(403);
  });

  it("OWNER kullanıcı listesini 200 ile alır", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: "/tenant/users", headers: authHeader() });

    expect(response.statusCode).toBe(200);
  });

  it("OWNER bekleyen davetleri 200 ile alır", async () => {
    const { scopedDb } = createMockScopedDb();
    const app = buildTestApp(scopedDb);

    const response = await app.inject({ method: "GET", url: "/tenant/invitations", headers: authHeader() });

    expect(response.statusCode).toBe(200);
  });
});

describe("PATCH /tenant/users/:id/role", () => {
  it("kendi rolünü değiştirmeye çalışan OWNER 400 alır", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "PATCH",
      url: "/tenant/users/owner-1/role",
      headers: authHeader({ userId: "owner-1" }),
      payload: { role: "ENGINEER" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("başka tenant'a ait kullanıcı için 404 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx({ targetRow: { id: "user-2", tenantId: "other-tenant", role: Role.ENGINEER, deactivatedAt: null } });
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "PATCH",
      url: "/tenant/users/user-2/role",
      headers: authHeader(),
      payload: { role: "RECEPTIONIST" },
    });

    expect(response.statusCode).toBe(404);
  });

  it("tenant'ın tek aktif OWNER'ının rolü değiştirilmeye çalışılırsa 409 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx({
      targetRow: { id: "user-2", tenantId, role: Role.OWNER, deactivatedAt: null },
      ownerCount: 1,
    });
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "PATCH",
      url: "/tenant/users/user-2/role",
      headers: authHeader(),
      payload: { role: "ENGINEER" },
    });

    expect(response.statusCode).toBe(409);
  });

  it("geçerli bir rol değişikliği 200 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx, userUpdate } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "PATCH",
      url: "/tenant/users/user-2/role",
      headers: authHeader(),
      payload: { role: "RECEPTIONIST" },
    });

    expect(response.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-2", tenantId },
      data: { role: "RECEPTIONIST" },
    });
  });
});

describe("POST /tenant/users/:id/deactivate", () => {
  it("kendini deaktive etmeye çalışan OWNER 400 alır", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: "/tenant/users/owner-1/deactivate",
      headers: authHeader({ userId: "owner-1" }),
    });

    expect(response.statusCode).toBe(400);
  });

  it("geçerli bir deaktivasyon 200 döner", async () => {
    const { scopedDb } = createMockScopedDb();
    const { tx, userUpdate } = createFakeTx();
    const app = buildTestApp(scopedDb, tx);

    const response = await app.inject({
      method: "POST",
      url: "/tenant/users/user-2/deactivate",
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-2", tenantId },
      data: { deactivatedAt: expect.any(Date) as Date },
    });
  });
});
