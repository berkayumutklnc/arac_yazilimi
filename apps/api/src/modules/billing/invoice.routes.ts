import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getInvoiceForWorkOrder,
  markInvoicePaid,
  voidInvoice,
  InvoiceNotFoundError,
  MissingInvoiceTransitionReasonError,
} from "./invoice.service.js";
import { InvalidInvoiceTransitionError } from "./invoiceStatus.machine.js";
import { issueInvoiceTransactional } from "./invoiceTransactional.js";
import { createAuthPreHandler } from "../../middleware/authPreHandler.js";
import { requireRole } from "../../middleware/requireRole.js";
import { Role } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import "../../types/fastify.js";

// bkz. ADR 0014 — kullanıcıyla netleşen karar: fatura aksiyonları (ISSUE/PAY/VOID)
// ve görüntüleme yalnızca OWNER + RECEPTIONIST.
const BILLING_ROLES: readonly Role[] = [Role.OWNER, Role.RECEPTIONIST];

const workOrderParamsSchema = z.object({ id: z.string().min(1) });
const invoiceParamsSchema = z.object({ id: z.string().min(1) });
const voidBodySchema = z.object({ reason: z.string().min(1) });

function mapCommonErrors(err: unknown): { code: number; body: Record<string, unknown> } | undefined {
  if (err instanceof InvoiceNotFoundError) {
    return { code: 404, body: { error: err.message } };
  }
  if (err instanceof InvalidInvoiceTransitionError) {
    return { code: 409, body: { error: err.message, from: err.from, to: err.to } };
  }
  if (err instanceof MissingInvoiceTransitionReasonError) {
    return { code: 400, body: { error: err.message, from: err.from, to: err.to } };
  }
  return undefined;
}

export function registerInvoiceRoutes(app: FastifyInstance, prisma: PrismaClient, jwtSecret: string): void {
  const authPreHandler = createAuthPreHandler(prisma, jwtSecret);

  app.get("/work-orders/:id/invoice", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, BILLING_ROLES)) {
      return;
    }

    const params = workOrderParamsSchema.parse(request.params);

    try {
      const invoice = await getInvoiceForWorkOrder(request.tenantDb, params.id);
      return await reply.code(200).send(invoice);
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });

  app.post("/invoices/:id/issue", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, BILLING_ROLES)) {
      return;
    }

    const params = invoiceParamsSchema.parse(request.params);

    try {
      const invoice = await issueInvoiceTransactional(
        prisma,
        request.authContext.tenantId,
        params.id,
        request.authContext.userId,
      );
      return await reply.code(200).send(invoice);
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });

  app.post("/invoices/:id/pay", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, BILLING_ROLES)) {
      return;
    }

    const params = invoiceParamsSchema.parse(request.params);

    try {
      const invoice = await markInvoicePaid(request.tenantDb, {
        invoiceId: params.id,
        actorId: request.authContext.userId,
      });
      return await reply.code(200).send(invoice);
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });

  app.post("/invoices/:id/void", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, BILLING_ROLES)) {
      return;
    }

    const params = invoiceParamsSchema.parse(request.params);
    const body = voidBodySchema.parse(request.body);

    try {
      const invoice = await voidInvoice(request.tenantDb, {
        invoiceId: params.id,
        actorId: request.authContext.userId,
        reason: body.reason,
      });
      return await reply.code(200).send(invoice);
    } catch (err) {
      const mapped = mapCommonErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });
}
