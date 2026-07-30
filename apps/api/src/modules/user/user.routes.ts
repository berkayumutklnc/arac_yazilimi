import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createInvitation, listInvitations } from "../invitation/invitation.service.js";
import { listTenantUsers } from "./userManagement.service.js";
import { changeUserRoleTransactional, deactivateUserTransactional } from "./userManagementTransactional.js";
import {
  CannotModifySelfError,
  CannotRemoveLastOwnerError,
  UserNotFoundError,
} from "./userManagement.service.js";
import { Role } from "../../generated/prisma/enums.js";
import { createAuthPreHandler } from "../../middleware/authPreHandler.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import type { EmailSender } from "../../notifications/emailSender.js";
import "../../types/fastify.js";

const OWNER_ROLES: readonly Role[] = [Role.OWNER];

// SUPER_ADMIN tenant-içi bir davet rolü olarak asla verilemez — yalnızca ilk
// OWNER, SUPER_ADMIN'in /admin/tenants akışıyla davet edilir (bkz. ADR 0010).
const invitableRoles = [Role.OWNER, Role.ENGINEER, Role.RECEPTIONIST, Role.DEALER] as const;
const inviteBodySchema = z.object({
  email: z.string().email(),
  role: z.enum(invitableRoles),
});
const roleParamsSchema = z.object({ id: z.string().min(1) });
const changeRoleBodySchema = z.object({ role: z.enum(invitableRoles) });

function mapUserManagementErrors(err: unknown): { code: number; body: { error: string } } | undefined {
  if (err instanceof CannotModifySelfError) {
    return { code: 400, body: { error: err.message } };
  }
  if (err instanceof UserNotFoundError) {
    return { code: 404, body: { error: err.message } };
  }
  if (err instanceof CannotRemoveLastOwnerError) {
    return { code: 409, body: { error: err.message } };
  }
  return undefined;
}

export function registerUserRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  jwtSecret: string,
  emailSender: EmailSender,
  webAppBaseUrl: string,
): void {
  const authPreHandler = createAuthPreHandler(prisma, jwtSecret);

  app.post("/tenant/users/invite", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, OWNER_ROLES)) {
      return;
    }

    const body = inviteBodySchema.parse(request.body);
    const { invitation, rawToken } = await createInvitation(request.tenantDb, {
      tenantId: request.authContext.tenantId,
      email: body.email,
      role: body.role,
      invitedBy: request.authContext.userId,
    });

    try {
      const redeemUrl = new URL(`/invite/accept?token=${rawToken}`, webAppBaseUrl).toString();
      await emailSender.sendInvitationEmail({
        toEmail: body.email,
        tenantName: request.authContext.tenantId,
        role: body.role,
        redeemUrl,
        expiresAt: invitation.expiresAt,
      });
    } catch (err) {
      console.error(`Davet e-postası gönderilemedi (invitation=${invitation.id}):`, err);
    }

    // Ham davet token'ı ASLA API yanıtında dönmez.
    return reply.code(201).send({
      invitation: {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      },
    });
  });

  app.get("/tenant/users", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, OWNER_ROLES)) {
      return;
    }

    const items = await listTenantUsers(request.tenantDb, request.authContext.tenantId);
    return reply.code(200).send({ items });
  });

  app.get("/tenant/invitations", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, OWNER_ROLES)) {
      return;
    }

    const items = await listInvitations(request.tenantDb, request.authContext.tenantId);
    return reply.code(200).send({ items });
  });

  app.patch("/tenant/users/:id/role", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, OWNER_ROLES)) {
      return;
    }

    const params = roleParamsSchema.parse(request.params);
    const body = changeRoleBodySchema.parse(request.body);
    const actingUser = {
      id: request.authContext.userId,
      tenantId: request.authContext.tenantId,
      role: request.authContext.role,
    };

    try {
      await changeUserRoleTransactional(prisma, request.authContext.tenantId, actingUser, params.id, body.role);
      return await reply.code(200).send({ status: "ok" });
    } catch (err) {
      const mapped = mapUserManagementErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });

  app.post("/tenant/users/:id/deactivate", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, OWNER_ROLES)) {
      return;
    }

    const params = roleParamsSchema.parse(request.params);
    const actingUser = {
      id: request.authContext.userId,
      tenantId: request.authContext.tenantId,
      role: request.authContext.role,
    };

    try {
      await deactivateUserTransactional(prisma, request.authContext.tenantId, actingUser, params.id);
      return await reply.code(200).send({ status: "ok" });
    } catch (err) {
      const mapped = mapUserManagementErrors(err);
      if (mapped) {
        return reply.code(mapped.code).send(mapped.body);
      }
      throw err;
    }
  });
}
