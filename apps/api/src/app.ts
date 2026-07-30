import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { registerWorkOrderRoutes } from "./modules/workorder/workOrder.routes.js";
import { registerAuthRoutes } from "./modules/auth/authRoutes.js";
import { registerEcuFileRoutes } from "./modules/ecufile/ecuFile.routes.js";
import { registerFileRequestRoutes } from "./modules/dealer/fileRequest.routes.js";
import type { EcuFileStoragePort } from "./modules/ecufile/ecuFileUpload.service.js";
import type { EcuFileDownloadStoragePort } from "./modules/ecufile/ecuFileDownload.service.js";
import type { DiagnosticReportDiagClient } from "./modules/workorder/workOrderDiagnostics.service.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const DIAGNOSTIC_LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB — bkz. docs/security-audit.md DÜŞÜK-1

export interface BuildAppConfig {
  jwtSecret: string;
  storage: EcuFileStoragePort & EcuFileDownloadStoragePort;
  diagServiceClient: DiagnosticReportDiagClient;
}

export function buildApp(prisma: PrismaClient, config: BuildAppConfig): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({ error: "Geçersiz istek gövdesi", issues: error.issues });
    }
    return reply.send(error);
  });

  app.register(cookie);
  app.register(multipart, {
    limits: { fileSize: DIAGNOSTIC_LOG_MAX_BYTES, files: 1 },
  });

  app.get("/health", () => ({ status: "ok" }));

  // Kimlik doğrulama gerektirmeyen tek route'lar — burada asla tenantId/rol
  // client'tan okunmaz, login/refresh'in kendisi kimliği kurar.
  registerAuthRoutes(app, { loginDb: prisma, refreshDb: prisma, jwtSecret: config.jwtSecret });

  // Korumalı route'lar: authPreHandler ile request.authContext/request.tenantDb
  // set edilmeden hiçbir handler'a girilmez (bkz. docs/security-audit.md KRİTİK-0).
  registerWorkOrderRoutes(app, prisma, config.jwtSecret, config.diagServiceClient);
  registerEcuFileRoutes(app, prisma, config.jwtSecret, config.storage);
  registerFileRequestRoutes(app, prisma, config.jwtSecret);

  return app;
}
