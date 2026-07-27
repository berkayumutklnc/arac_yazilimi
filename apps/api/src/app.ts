import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { registerWorkOrderRoutes } from "./modules/workorder/workOrder.routes.js";
import type { WorkOrderTransitionDb } from "./modules/workorder/workOrderTransition.service.js";

export function buildApp(db: WorkOrderTransitionDb): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Geçersiz istek gövdesi", issues: error.issues });
    }
    return reply.send(error);
  });

  app.get("/health", () => ({ status: "ok" }));
  registerWorkOrderRoutes(app, db);

  return app;
}
