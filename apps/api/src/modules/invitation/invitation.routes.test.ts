import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerInvitationRoutes } from "./invitation.routes.js";
import { Role } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

const rawToken = "d".repeat(64);

function buildTestApp(overrides: {
  findUnique?: ReturnType<typeof vi.fn>;
  transaction?: ReturnType<typeof vi.fn>;
}) {
  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Geçersiz istek gövdesi", issues: error.issues });
    }
    return reply.send(error);
  });

  const invitationFindUnique =
    overrides.findUnique ??
    vi.fn().mockResolvedValue({
      id: "inv-1",
      tenantId: "tenant-1",
      email: "new@acme.test",
      role: Role.ENGINEER,
      expiresAt: new Date(Date.now() + 60_000),
      acceptedAt: null,
      revokedAt: null,
    });
  const transaction =
    overrides.transaction ??
    vi.fn((fn: (tx: unknown) => unknown) => {
      const tx = {
        invitation: {
          findUnique: invitationFindUnique,
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        user: { create: vi.fn().mockResolvedValue({ id: "user-1" }) },
      };
      return fn(tx);
    });

  const prisma = {
    invitation: { findUnique: invitationFindUnique },
    $transaction: transaction,
  } as unknown as PrismaClient;

  registerInvitationRoutes(app, prisma);
  return app;
}

describe("GET /invitations/:token", () => {
  it("geçerli token için tenantId/email/role önizlemesi 200 ile döner", async () => {
    const app = buildTestApp({});

    const response = await app.inject({ method: "GET", url: `/invitations/${rawToken}` });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ tenantId: "tenant-1", email: "new@acme.test", role: "ENGINEER" });
  });

  it("geçersiz token için 400 + generic hata döner", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const app = buildTestApp({ findUnique });

    const response = await app.inject({ method: "GET", url: `/invitations/${rawToken}` });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toHaveProperty("error");
  });
});

describe("POST /invitations/redeem", () => {
  it("geçerli token + şifre ile 200 döner", async () => {
    const app = buildTestApp({});

    const response = await app.inject({
      method: "POST",
      url: "/invitations/redeem",
      payload: { token: rawToken, newPassword: "yeni-guclu-sifre-123" },
    });

    expect(response.statusCode).toBe(200);
  });

  it("geçersiz token için 400 döner", async () => {
    const transaction = vi.fn((fn: (tx: unknown) => unknown) => {
      const tx = {
        invitation: {
          findUnique: vi.fn().mockResolvedValue(null),
          updateMany: vi.fn(),
        },
        user: { create: vi.fn() },
      };
      return fn(tx);
    });
    const app = buildTestApp({ transaction });

    const response = await app.inject({
      method: "POST",
      url: "/invitations/redeem",
      payload: { token: rawToken, newPassword: "yeni-guclu-sifre-123" },
    });

    expect(response.statusCode).toBe(400);
  });

  it("eksik gövde için 400 döner", async () => {
    const app = buildTestApp({});

    const response = await app.inject({ method: "POST", url: "/invitations/redeem", payload: {} });

    expect(response.statusCode).toBe(400);
  });
});
