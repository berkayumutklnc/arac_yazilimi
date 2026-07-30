import type { FastifyReply, FastifyRequest } from "fastify";
import type { PrismaClient } from "../generated/prisma/client.js";
import { createTenantScopedDb } from "../db/tenantScopedDb.js";
import { InvalidAccessTokenError, verifyAccessToken } from "../modules/auth/authToken.js";
import "../types/fastify.js";

const BEARER_PREFIX = "Bearer ";

export function createAuthPreHandler(prisma: PrismaClient, jwtSecret: string) {
  return async function authPreHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const header = request.headers.authorization;
    if (!header || !header.startsWith(BEARER_PREFIX)) {
      await reply.code(401).send({ error: "Yetkilendirme başlığı eksik veya hatalı." });
      return;
    }

    const token = header.slice(BEARER_PREFIX.length);

    try {
      const payload = verifyAccessToken(token, jwtSecret);
      request.authContext = payload;
      request.tenantDb = createTenantScopedDb(prisma, payload.tenantId);
    } catch (err) {
      if (err instanceof InvalidAccessTokenError) {
        await reply.code(401).send({ error: err.message });
        return;
      }
      throw err;
    }
  };
}
