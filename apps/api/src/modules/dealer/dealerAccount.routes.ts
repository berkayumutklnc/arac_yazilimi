import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
import { DealerAccountNotActiveError } from "./dealerCreditTopup.service.js";
import { topUpDealerCreditTransactional } from "./dealerCreditTopupTransactional.js";
import { Role } from "../../generated/prisma/enums.js";
import { createAuthPreHandler } from "../../middleware/authPreHandler.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import "../../types/fastify.js";

const OWNER_ROLES: readonly Role[] = [Role.OWNER];

const idParamsSchema = z.object({ id: z.string().min(1) });
const proposeBodySchema = z.object({ dealerTenantSlug: z.string().min(1) });
const respondBodySchema = z.object({ approve: z.boolean() });
const creditTopUpBodySchema = z.object({ amountKurus: z.number().int().positive() });

// DealerAccount/Tenant BİLİNÇLİ OLARAK tenant-scope extension'ın DIŞINDA
// (bkz. ADR 0006/0013) — ham prisma ile, elle yetkilendirme (dealerLink.service.ts
// içinde) kullanılır — fileRequest.routes.ts'nin buildFileRequestDb deseniyle aynı.
function buildDealerLinkDb(prisma: PrismaClient): DealerLinkDb {
  return {
    tenant: { findUnique: (args) => prisma.tenant.findUnique(args) },
    dealerAccount: {
      findFirst: (args) => prisma.dealerAccount.findFirst(args),
      create: (args) => prisma.dealerAccount.create(args),
      findUnique: (args) => prisma.dealerAccount.findUnique(args),
      updateMany: (args) => prisma.dealerAccount.updateMany(args),
      findMany: (args) => prisma.dealerAccount.findMany(args),
    },
  };
}

function actingUserFrom(request: { authContext: { userId: string; tenantId: string; role: Role } }): ActingUser {
  return {
    id: request.authContext.userId,
    tenantId: request.authContext.tenantId,
    role: request.authContext.role,
  };
}

function mapCommonErrors(err: unknown): { code: number; body: { error: string } } | undefined {
  if (err instanceof ForbiddenDealerLinkActionError) {
    return { code: 403, body: { error: err.message } };
  }
  if (err instanceof DealerTenantNotFoundError || err instanceof DealerLinkNotFoundError) {
    return { code: 404, body: { error: err.message } };
  }
  if (err instanceof DealerLinkAlreadyExistsError) {
    return { code: 409, body: { error: err.message } };
  }
  if (err instanceof ConcurrentDealerLinkResponseError || err instanceof DealerAccountNotActiveError) {
    return { code: 409, body: { error: err.message } };
  }
  return undefined;
}

export function registerDealerAccountRoutes(app: FastifyInstance, prisma: PrismaClient, jwtSecret: string): void {
  const authPreHandler = createAuthPreHandler(prisma, jwtSecret);
  const db = buildDealerLinkDb(prisma);

  app.post("/dealer/links", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, OWNER_ROLES)) {
      return;
    }

    const body = proposeBodySchema.parse(request.body);

    try {
      const link = await proposeDealerLink(db, actingUserFrom(request), { dealerTenantSlug: body.dealerTenantSlug });
      return await reply.code(201).send(link);
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });

  app.post("/dealer/links/:id/respond", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, OWNER_ROLES)) {
      return;
    }

    const params = idParamsSchema.parse(request.params);
    const body = respondBodySchema.parse(request.body);

    try {
      await respondToDealerLink(db, actingUserFrom(request), params.id, body.approve);
      return await reply.code(200).send({ status: body.approve ? "ACTIVE" : "REJECTED" });
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });

  app.get("/dealer/links", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, OWNER_ROLES)) {
      return;
    }

    const items = await listDealerLinks(db, actingUserFrom(request));
    return reply.code(200).send({ items });
  });

  app.post("/dealer/accounts/:id/credit-topup", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, OWNER_ROLES)) {
      return;
    }

    const params = idParamsSchema.parse(request.params);
    const body = creditTopUpBodySchema.parse(request.body);

    try {
      const result = await topUpDealerCreditTransactional(
        prisma,
        actingUserFrom(request),
        params.id,
        body.amountKurus,
      );
      return await reply.code(200).send(result);
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });
}
