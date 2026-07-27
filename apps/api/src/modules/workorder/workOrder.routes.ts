import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  transitionWorkOrderStatus,
  WorkOrderNotFoundError,
  type WorkOrderTransitionDb,
} from "./workOrderTransition.service.js";
import { InvalidWorkOrderTransitionError, WORK_ORDER_STATUS_ORDER } from "./workOrderStatus.machine.js";

const paramsSchema = z.object({ id: z.string().min(1) });

const bodySchema = z.object({
  // Epic 0 (auth/tenant middleware) tamamlanana kadar tenantId istek gövdesinden
  // alınıyor; sonrasında oturumdan (request.tenantId) okunacak şekilde değişecek.
  tenantId: z.string().min(1),
  toStatus: z.enum(WORK_ORDER_STATUS_ORDER),
  changedBy: z.string().min(1),
});

export function registerWorkOrderRoutes(app: FastifyInstance, db: WorkOrderTransitionDb): void {
  app.patch("/work-orders/:id/status", async (request, reply) => {
    const params = paramsSchema.parse(request.params);
    const body = bodySchema.parse(request.body);

    try {
      await transitionWorkOrderStatus(db, {
        workOrderId: params.id,
        tenantId: body.tenantId,
        toStatus: body.toStatus,
        changedBy: body.changedBy,
      });
    } catch (err) {
      if (err instanceof InvalidWorkOrderTransitionError) {
        return reply.code(409).send({ error: err.message, from: err.from, to: err.to });
      }
      if (err instanceof WorkOrderNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }

    return reply.code(200).send({ status: body.toStatus });
  });
}
