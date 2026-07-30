import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { previewInvitation, InvalidInvitationTokenError } from "./invitationRedemption.service.js";
import { redeemInvitationTransactional } from "./invitationRedemptionTransactional.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

const tokenParamsSchema = z.object({ token: z.string().min(1) });
const redeemBodySchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8) });

// Kimlik doğrulama gerektirmeyen tek route'lar (registerAuthRoutes ile aynı
// kategori) — davet edilen kullanıcı henüz sisteme hiç giremiyor. Hiçbir
// handler request gövdesinden tenantId/rol GÜVENMEZ; ikisi de yalnızca
// (hash'lenmiş) token'dan çözülür.
export function registerInvitationRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/invitations/:token", async (request, reply) => {
    const params = tokenParamsSchema.parse(request.params);

    try {
      const preview = await previewInvitation({ invitation: prisma.invitation }, params.token);
      return await reply.code(200).send(preview);
    } catch (err) {
      if (err instanceof InvalidInvitationTokenError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post("/invitations/redeem", async (request, reply) => {
    const body = redeemBodySchema.parse(request.body);

    try {
      await redeemInvitationTransactional(prisma, body.token, body.newPassword);
      return await reply.code(200).send({ ok: true });
    } catch (err) {
      if (err instanceof InvalidInvitationTokenError) {
        return reply.code(400).send({ error: err.message });
      }
      throw err;
    }
  });
}
