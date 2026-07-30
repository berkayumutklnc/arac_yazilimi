import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createTenantWithFirstInvitation,
  listTenants,
  TenantSlugAlreadyExistsError,
} from "./adminTenant.service.js";
import { Role } from "../../generated/prisma/enums.js";
import { createAuthPreHandler } from "../../middleware/authPreHandler.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { EmailSender } from "../../notifications/emailSender.js";
import "../../types/fastify.js";

const SUPER_ADMIN_ROLES: readonly Role[] = [Role.SUPER_ADMIN];

const createTenantBodySchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  ownerEmail: z.string().email(),
});

// Admin route'ları BİLİNÇLİ OLARAK request.tenantDb kullanmaz — ham `prisma`
// ile çalışır, requireRole(SUPER_ADMIN) tek koruma katmanı (bkz. ADR 0010).
export function registerAdminTenantRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  jwtSecret: string,
  emailSender: EmailSender,
  webAppBaseUrl: string,
): void {
  const authPreHandler = createAuthPreHandler(prisma, jwtSecret);

  app.post("/admin/tenants", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, SUPER_ADMIN_ROLES)) {
      return;
    }

    const body = createTenantBodySchema.parse(request.body);

    try {
      const result = await createTenantWithFirstInvitation(
        { db: prisma, emailSender, webAppBaseUrl },
        {
          name: body.name,
          slug: body.slug,
          ownerEmail: body.ownerEmail,
          createdBy: request.authContext.userId,
        },
      );
      // Ham davet token'ı ASLA API yanıtında dönmez — yalnızca e-posta ile
      // (bkz. EmailSender) taşınır.
      return await reply.code(201).send({ tenant: result.tenant });
    } catch (err) {
      if (err instanceof TenantSlugAlreadyExistsError) {
        return reply.code(409).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/admin/tenants", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, SUPER_ADMIN_ROLES)) {
      return;
    }

    const items = await listTenants(prisma);
    return reply.code(200).send({ items });
  });
}
