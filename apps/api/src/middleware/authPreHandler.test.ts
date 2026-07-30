import { describe, expect, it, vi } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createAuthPreHandler } from "./authPreHandler.js";
import { signAccessToken } from "../modules/auth/authToken.js";
import { Role } from "../generated/prisma/enums.js";
import type { PrismaClient } from "../generated/prisma/client.js";

const jwtSecret = "test-secret";

function createFakeRequest(headers: Record<string, string> = {}): FastifyRequest {
  return { headers } as unknown as FastifyRequest;
}

function createFakeReply() {
  const code = vi.fn().mockReturnThis();
  const send = vi.fn().mockReturnThis();
  const reply = { code, send } as unknown as FastifyReply;
  return { reply, code, send };
}

function createFakePrisma() {
  const extendedClient = { __marker: "extended" };
  const $extends = vi.fn().mockReturnValue(extendedClient);
  const prisma = { $extends } as unknown as PrismaClient;
  return { prisma, $extends, extendedClient };
}

describe("authPreHandler", () => {
  it("Authorization başlığı yoksa 401 döner, authContext set edilmez", async () => {
    const { prisma } = createFakePrisma();
    const preHandler = createAuthPreHandler(prisma, jwtSecret);
    const request = createFakeRequest();
    const { reply, code, send } = createFakeReply();

    await preHandler(request, reply);

    expect(code).toHaveBeenCalledWith(401);
    expect(send).toHaveBeenCalled();
    expect(request.authContext).toBeUndefined();
  });

  it("'Bearer ' önekiyle başlamayan başlık için 401 döner", async () => {
    const { prisma } = createFakePrisma();
    const preHandler = createAuthPreHandler(prisma, jwtSecret);
    const request = createFakeRequest({ authorization: "Basic abc123" });
    const { reply, code } = createFakeReply();

    await preHandler(request, reply);

    expect(code).toHaveBeenCalledWith(401);
  });

  it("geçersiz/sahte token için 401 döner", async () => {
    const { prisma } = createFakePrisma();
    const preHandler = createAuthPreHandler(prisma, jwtSecret);
    const request = createFakeRequest({ authorization: "Bearer not-a-real-token" });
    const { reply, code } = createFakeReply();

    await preHandler(request, reply);

    expect(code).toHaveBeenCalledWith(401);
  });

  it("başka bir sırla imzalanmış token için 401 döner", async () => {
    const { prisma } = createFakePrisma();
    const preHandler = createAuthPreHandler(prisma, jwtSecret);
    const forgedToken = signAccessToken(
      { userId: "u1", tenantId: "t1", role: Role.OWNER },
      "wrong-secret",
    );
    const request = createFakeRequest({ authorization: `Bearer ${forgedToken}` });
    const { reply, code } = createFakeReply();

    await preHandler(request, reply);

    expect(code).toHaveBeenCalledWith(401);
  });

  it("geçerli token: authContext set edilir, tenantDb prisma.$extends çıktısına eşitlenir, 401 dönmez", async () => {
    const { prisma, $extends, extendedClient } = createFakePrisma();
    const preHandler = createAuthPreHandler(prisma, jwtSecret);
    const token = signAccessToken({ userId: "u1", tenantId: "t1", role: Role.ENGINEER }, jwtSecret);
    const request = createFakeRequest({ authorization: `Bearer ${token}` });
    const { reply, code } = createFakeReply();

    await preHandler(request, reply);

    expect(code).not.toHaveBeenCalled();
    expect(request.authContext).toEqual({ userId: "u1", tenantId: "t1", role: Role.ENGINEER });
    expect($extends).toHaveBeenCalled();
    expect(request.tenantDb).toBe(extendedClient);
  });
});
