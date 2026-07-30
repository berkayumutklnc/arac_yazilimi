import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createFileRequest,
  transitionFileRequestStatus,
  createFileRequestInputSchema,
  ForbiddenRoleError,
  DealerAccountNotFoundError,
  FileRequestNotFoundError,
  MissingCostError,
  VehicleNotFoundError,
  type ActingUser,
  type FileRequestDb,
} from "./fileRequest.service.js";
import { InvalidFileRequestTransitionError } from "./fileRequestStatus.machine.js";
import { InsufficientCreditError, MissingRequestCostError } from "./fileRequestFulfillment.service.js";
import {
  fulfillFileRequestTransactional,
  ConcurrentFulfillmentError,
} from "./fileRequestFulfillmentTransactional.js";
import { listFileRequests, getDealerAccountBalance } from "./fileRequestQuery.service.js";
import { Role } from "../../generated/prisma/enums.js";
import { createAuthPreHandler } from "../../middleware/authPreHandler.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AppScopedDb } from "../../db/tenantScopedDb.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import "../../types/fastify.js";

const HUB_ROLES: readonly Role[] = [Role.OWNER, Role.ENGINEER];
const DEALER_ROLES: readonly Role[] = [Role.DEALER];
const FILE_REQUEST_VIEW_ROLES: readonly Role[] = [...HUB_ROLES, ...DEALER_ROLES];

const idParamsSchema = z.object({ id: z.string().min(1) });
const acceptBodySchema = z.object({ costKurus: z.number().int().nonnegative() });
const fulfillBodySchema = z.object({ storageKey: z.string().min(1), checksum: z.string().min(1) });
const dealerAccountQuerySchema = z.object({ hubTenantId: z.string().min(1) });

// FileRequest/DealerAccount/FileRequestStatusAuditLog bilinçli olarak
// tenant-scope extension'ın DIŞINDA (bkz. ADR 0006) — iki-tenant ilişkisi
// olduğu için "otomatik benim tenant'ım" filtresi yanlış sonuç verir. Vehicle
// İSE tek-tenant bir model, `tenantDb.vehicle` üzerinden zaten doğru şekilde
// scoped geliyor (KRİTİK-2 fix'inin korunması için buradan alınmalı, raw
// `prisma.vehicle` DEĞİL).
function buildFileRequestDb(prisma: PrismaClient, tenantDb: AppScopedDb): FileRequestDb {
  return {
    vehicle: tenantDb.vehicle,
    dealerAccount: {
      findFirst: (args) => prisma.dealerAccount.findFirst(args),
    },
    fileRequest: {
      create: (args) => prisma.fileRequest.create(args),
      findUnique: (args) => prisma.fileRequest.findUnique(args),
      update: (args) => prisma.fileRequest.update(args),
    },
    fileRequestStatusAuditLog: {
      create: (args) => prisma.fileRequestStatusAuditLog.create(args),
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
  if (err instanceof ForbiddenRoleError) {
    return { code: 403, body: { error: err.message } };
  }
  if (err instanceof FileRequestNotFoundError || err instanceof DealerAccountNotFoundError) {
    return { code: 404, body: { error: err.message } };
  }
  if (err instanceof VehicleNotFoundError) {
    return { code: 404, body: { error: err.message } };
  }
  return undefined;
}

export function registerFileRequestRoutes(app: FastifyInstance, prisma: PrismaClient, jwtSecret: string): void {
  const authPreHandler = createAuthPreHandler(prisma, jwtSecret);

  app.post("/dealer/file-requests", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, DEALER_ROLES)) {
      return;
    }

    const body = createFileRequestInputSchema.parse(request.body);
    const db = buildFileRequestDb(prisma, request.tenantDb);

    try {
      const result = await createFileRequest(db, actingUserFrom(request), body);
      return await reply.code(201).send(result);
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });

  function registerTransition(path: string, toStatus: "ACCEPTED" | "IN_PROGRESS" | "REJECTED") {
    app.patch(path, { preHandler: authPreHandler }, async (request, reply) => {
      if (!requireRole(request, reply, HUB_ROLES)) {
        return;
      }

      const params = idParamsSchema.parse(request.params);
      const costKurus =
        toStatus === "ACCEPTED" ? acceptBodySchema.parse(request.body).costKurus : undefined;
      const db = buildFileRequestDb(prisma, request.tenantDb);

      try {
        await transitionFileRequestStatus(db, {
          fileRequestId: params.id,
          hubTenantId: request.authContext.tenantId,
          toStatus,
          actingUser: actingUserFrom(request),
          costKurus,
        });
        return await reply.code(200).send({ status: toStatus });
      } catch (err) {
        const mapped = mapCommonErrors(err);
        if (mapped) {
          return reply.code(mapped.code).send(mapped.body);
        }
        if (err instanceof InvalidFileRequestTransitionError) {
          return reply.code(409).send({ error: err.message, from: err.from, to: err.to });
        }
        if (err instanceof MissingCostError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    });
  }

  registerTransition("/dealer/file-requests/:id/accept", "ACCEPTED");
  registerTransition("/dealer/file-requests/:id/reject", "REJECTED");
  registerTransition("/dealer/file-requests/:id/start", "IN_PROGRESS");

  app.get("/dealer/file-requests", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, FILE_REQUEST_VIEW_ROLES)) {
      return;
    }

    const items = await listFileRequests(
      { fileRequest: { findMany: (args) => prisma.fileRequest.findMany(args) } },
      actingUserFrom(request),
    );
    return reply.code(200).send({ items });
  });

  app.get("/dealer/account", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, DEALER_ROLES)) {
      return;
    }

    const query = dealerAccountQuerySchema.parse(request.query);

    try {
      const balance = await getDealerAccountBalance(
        { dealerAccount: { findFirst: (args) => prisma.dealerAccount.findFirst(args) } },
        { hubTenantId: query.hubTenantId, dealerTenantId: request.authContext.tenantId },
      );
      return await reply.code(200).send(balance);
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });

  app.post("/dealer/file-requests/:id/fulfill", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, HUB_ROLES)) {
      return;
    }

    const params = idParamsSchema.parse(request.params);
    const body = fulfillBodySchema.parse(request.body);

    try {
      const result = await fulfillFileRequestTransactional(prisma, {
        fileRequestId: params.id,
        hubTenantId: request.authContext.tenantId,
        actingUser: actingUserFrom(request),
        storageKey: body.storageKey,
        checksum: body.checksum,
      });
      return await reply.code(200).send(result);
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      if (
        err instanceof InsufficientCreditError ||
        err instanceof MissingRequestCostError ||
        err instanceof ConcurrentFulfillmentError
      ) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });
}
