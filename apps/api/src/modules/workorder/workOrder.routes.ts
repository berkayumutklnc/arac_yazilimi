import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  transitionWorkOrderStatus,
  WorkOrderNotFoundError,
  MissingTransitionReasonError,
} from "./workOrderTransition.service.js";
import { InvalidWorkOrderTransitionError, WORK_ORDER_STATUS_ORDER } from "./workOrderStatus.machine.js";
import {
  createWorkOrder,
  listWorkOrders,
  getWorkOrderById,
  VehicleNotFoundError,
} from "./workOrderCrud.service.js";
import {
  addDiagnosticReport,
  listDiagnosticReports,
  type DiagnosticReportDiagClient,
} from "./workOrderDiagnostics.service.js";
import {
  DiagServiceUnavailableError,
  DiagServiceRequestError,
  DiagServiceContractError,
} from "../../diagService/diagServiceClient.js";
import { createAuthPreHandler } from "../../middleware/authPreHandler.js";
import { requireRole } from "../../middleware/requireRole.js";
import { Role } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import "../../types/fastify.js";

// DEALER hub-tarafı iş emirlerini yönetemez — dealer/hub ilişkisi ayrı bir
// akış (bkz. dealer/fileRequest.routes.ts). Mevcut PATCH .../status route'u
// bu rol kontrolünü henüz uygulamıyordu (bu göreve dahil değil); yeni
// route'lar baştan itibaren tutarlı bir savunma katmanıyla ekleniyor.
const WORKSHOP_ROLES: readonly Role[] = [Role.OWNER, Role.ENGINEER, Role.RECEPTIONIST];

const paramsSchema = z.object({ id: z.string().min(1) });
const createBodySchema = z.object({ vehicleId: z.string().min(1) });
const diagnosticReportTypeSchema = z.enum(["DTC", "WOT"]);

// tenantId ve changedBy artık gövdede DEĞİL (bkz. docs/security-audit.md
// KRİTİK-0, ADR 0006) — ikisi de yalnızca doğrulanmış JWT'den
// (request.authContext) okunur, istemci tarafından hiçbir şekilde belirlenemez.
const bodySchema = z.object({
  toStatus: z.enum(WORK_ORDER_STATUS_ORDER),
  // Rework (QUALITY_CHECK -> IN_PROGRESS) ve iptal (-> CANCELLED) dallarında
  // zorunlu — servis katmanı doğrular (bkz. ADR 0003 revizyonu).
  reason: z.string().min(1).optional(),
});

export function registerWorkOrderRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  jwtSecret: string,
  diagServiceClient: DiagnosticReportDiagClient,
): void {
  const authPreHandler = createAuthPreHandler(prisma, jwtSecret);

  app.patch(
    "/work-orders/:id/status",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const params = paramsSchema.parse(request.params);
      const body = bodySchema.parse(request.body);

      try {
        await transitionWorkOrderStatus(request.tenantDb, {
          workOrderId: params.id,
          toStatus: body.toStatus,
          changedBy: request.authContext.userId,
          reason: body.reason,
        });
      } catch (err) {
        if (err instanceof InvalidWorkOrderTransitionError) {
          return reply.code(409).send({ error: err.message, from: err.from, to: err.to });
        }
        if (err instanceof WorkOrderNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        if (err instanceof MissingTransitionReasonError) {
          return reply.code(400).send({ error: err.message, from: err.from, to: err.to });
        }
        throw err;
      }

      return reply.code(200).send({ status: body.toStatus });
    },
  );

  app.post("/work-orders", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, WORKSHOP_ROLES)) {
      return;
    }

    const body = createBodySchema.parse(request.body);

    try {
      const result = await createWorkOrder(request.tenantDb, { vehicleId: body.vehicleId });
      return await reply.code(201).send(result);
    } catch (err) {
      if (err instanceof VehicleNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  app.get("/work-orders", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, WORKSHOP_ROLES)) {
      return;
    }

    const items = await listWorkOrders(request.tenantDb);
    return reply.code(200).send({ items });
  });

  app.get("/work-orders/:id", { preHandler: authPreHandler }, async (request, reply) => {
    if (!requireRole(request, reply, WORKSHOP_ROLES)) {
      return;
    }

    const params = paramsSchema.parse(request.params);

    try {
      const workOrder = await getWorkOrderById(request.tenantDb, params.id);
      return await reply.code(200).send(workOrder);
    } catch (err) {
      if (err instanceof WorkOrderNotFoundError) {
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });

  app.post(
    "/work-orders/:id/diagnostic-reports",
    { preHandler: authPreHandler },
    async (request, reply) => {
      if (!requireRole(request, reply, WORKSHOP_ROLES)) {
        return;
      }

      const params = paramsSchema.parse(request.params);

      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: "Dosya yüklenmedi." });
      }

      // reportType, dosyadan ÖNCE eklenen bir multipart alanı olarak beklenir
      // (bkz. apps/web tarafı) — @fastify/multipart, file() dönene kadar
      // ayrıştırılmış alanları `data.fields`'te sağlar.
      const reportTypeField = data.fields.reportType;
      const reportTypeValue =
        reportTypeField && !Array.isArray(reportTypeField) && "value" in reportTypeField
          ? reportTypeField.value
          : undefined;
      const parsedReportType = diagnosticReportTypeSchema.safeParse(reportTypeValue);
      if (!parsedReportType.success) {
        return reply.code(400).send({ error: "Geçersiz veya eksik reportType (DTC|WOT bekleniyor)." });
      }

      const fileBuffer = await data.toBuffer();

      try {
        const report = await addDiagnosticReport(request.tenantDb, diagServiceClient, {
          workOrderId: params.id,
          reportType: parsedReportType.data,
          fileName: data.filename,
          fileBuffer,
          uploadedBy: request.authContext.userId,
        });
        return await reply.code(201).send(report);
      } catch (err) {
        if (err instanceof WorkOrderNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        // bkz. ADR 0009: diag-service'e ulaşılamıyorsa 503 (kuyruğa alma/retry
        // yok, net bir hata); istemci girdisi hatalıysa 400; sözleşme drift'i
        // (200 ama zod doğrulamasından geçemeyen yanıt) 502.
        if (err instanceof DiagServiceUnavailableError) {
          return reply.code(503).send({ error: err.message });
        }
        if (err instanceof DiagServiceRequestError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof DiagServiceContractError) {
          return reply.code(502).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    "/work-orders/:id/diagnostic-reports",
    { preHandler: authPreHandler },
    async (request, reply) => {
      if (!requireRole(request, reply, WORKSHOP_ROLES)) {
        return;
      }

      const params = paramsSchema.parse(request.params);
      const items = await listDiagnosticReports(request.tenantDb, params.id);
      return reply.code(200).send({ items });
    },
  );
}
