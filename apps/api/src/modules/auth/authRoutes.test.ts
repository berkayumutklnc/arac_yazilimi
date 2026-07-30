import { describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { registerAuthRoutes } from "./authRoutes.js";
import { hashPassword } from "./authPassword.js";
import { Role } from "../../generated/prisma/enums.js";
import type { AuthLoginDb } from "./authLogin.service.js";
import type { AuthRefreshDb } from "./authRefresh.service.js";

const jwtSecret = "test-secret";
const password = "correct-horse-battery-staple";

async function makeApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);

  const tenantFindUnique = vi.fn<AuthLoginDb["tenant"]["findUnique"]>();
  tenantFindUnique.mockResolvedValue({ id: "tenant-1" });

  const loginUserFindUnique = vi.fn<AuthLoginDb["user"]["findUnique"]>();
  loginUserFindUnique.mockResolvedValue({
    id: "user-1",
    tenantId: "tenant-1",
    passwordHash: await hashPassword(password),
    role: Role.OWNER,
  });

  const refreshTokenCreate = vi.fn<AuthLoginDb["refreshToken"]["create"]>();
  refreshTokenCreate.mockResolvedValue(undefined);

  const loginDb: AuthLoginDb = {
    tenant: { findUnique: tenantFindUnique },
    user: { findUnique: loginUserFindUnique },
    refreshToken: { create: refreshTokenCreate },
  };

  const refreshTokenFindUnique = vi.fn<AuthRefreshDb["refreshToken"]["findUnique"]>();
  const refreshTokenUpdate = vi.fn<AuthRefreshDb["refreshToken"]["update"]>();
  const refreshTokenCreate2 = vi.fn<AuthRefreshDb["refreshToken"]["create"]>();
  refreshTokenCreate2.mockResolvedValue({ id: "rt-2" });
  const refreshTokenUpdateMany = vi.fn<AuthRefreshDb["refreshToken"]["updateMany"]>();
  const refreshUserFindUnique = vi.fn<AuthRefreshDb["user"]["findUnique"]>();
  refreshUserFindUnique.mockResolvedValue({ id: "user-1", tenantId: "tenant-1", role: Role.OWNER });

  const refreshDb: AuthRefreshDb = {
    refreshToken: {
      findUnique: refreshTokenFindUnique,
      update: refreshTokenUpdate,
      create: refreshTokenCreate2,
      updateMany: refreshTokenUpdateMany,
    },
    user: { findUnique: refreshUserFindUnique },
  };

  registerAuthRoutes(app, { loginDb, refreshDb, jwtSecret });

  return { app, refreshTokenFindUnique };
}

function extractCookieValue(setCookieHeader: string | string[] | undefined, name: string): string | undefined {
  const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader ?? ""];
  for (const header of headers) {
    const match = header.match(new RegExp(`${name}=([^;]+)`));
    if (match) return match[1];
  }
  return undefined;
}

describe("POST /auth/login", () => {
  it("doğru bilgilerle 200 döner, accessToken içerir ve httpOnly refresh cookie set eder", async () => {
    const { app } = await makeApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { tenantSlug: "acme", email: "owner@acme.test", password },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("accessToken");
    const setCookie = response.headers["set-cookie"];
    expect(setCookie).toBeDefined();
    const setCookieStr = Array.isArray(setCookie) ? setCookie.join(";") : (setCookie ?? "");
    expect(setCookieStr).toContain("HttpOnly");
    expect(setCookieStr).toContain("refresh_token=");
  });

  it("yanlış şifre ile 401 döner", async () => {
    const { app } = await makeApp();

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { tenantSlug: "acme", email: "owner@acme.test", password: "wrong" },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe("POST /auth/refresh", () => {
  it("refresh cookie yoksa 401 döner", async () => {
    const { app } = await makeApp();

    const response = await app.inject({ method: "POST", url: "/auth/refresh" });

    expect(response.statusCode).toBe(401);
  });

  it("geçerli refresh cookie ile 200 döner, yeni (rotasyonlu) bir cookie set eder", async () => {
    const { app, refreshTokenFindUnique } = await makeApp();
    const presentedToken = "b".repeat(64);
    refreshTokenFindUnique.mockResolvedValue({
      id: "rt-1",
      userId: "user-1",
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      cookies: { refresh_token: presentedToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("accessToken");
    const newCookieValue = extractCookieValue(response.headers["set-cookie"], "refresh_token");
    expect(newCookieValue).toBeDefined();
    expect(newCookieValue).not.toBe(presentedToken);
  });

  it("bilinmeyen bir refresh cookie ile 401 döner", async () => {
    const { app, refreshTokenFindUnique } = await makeApp();
    refreshTokenFindUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      cookies: { refresh_token: "c".repeat(64) },
    });

    expect(response.statusCode).toBe(401);
  });
});
