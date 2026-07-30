import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { registerWorkOrderRoutes } from "./modules/workorder/workOrder.routes.js";
import { registerAuthRoutes } from "./modules/auth/authRoutes.js";
import { registerEcuFileRoutes } from "./modules/ecufile/ecuFile.routes.js";
import { registerFileRequestRoutes } from "./modules/dealer/fileRequest.routes.js";
import { registerDealerAccountRoutes } from "./modules/dealer/dealerAccount.routes.js";
import { registerInvitationRoutes } from "./modules/invitation/invitation.routes.js";
import { registerAdminTenantRoutes } from "./modules/admin/adminTenant.routes.js";
import { registerUserRoutes } from "./modules/user/user.routes.js";
import { registerInvoiceRoutes } from "./modules/billing/invoice.routes.js";
import type { EcuFileStoragePort } from "./modules/ecufile/ecuFileUpload.service.js";
import type { EcuFileDownloadStoragePort } from "./modules/ecufile/ecuFileDownload.service.js";
import type { DiagnosticReportDiagClient } from "./modules/workorder/workOrderDiagnostics.service.js";
import type { EmailSender } from "./notifications/emailSender.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const DIAGNOSTIC_LOG_MAX_BYTES = 10 * 1024 * 1024; // 10MB — bkz. docs/security-audit.md DÜŞÜK-1

export interface BuildAppConfig {
  jwtSecret: string;
  storage: EcuFileStoragePort & EcuFileDownloadStoragePort;
  diagServiceClient: DiagnosticReportDiagClient;
  emailSender: EmailSender;
  webAppBaseUrl: string;
  // Verilmezse logger tamamen kapalı kalır (mevcut test davranışı — log
  // spam'i istemiyoruz). Üretimde server.ts NODE_ENV=production'da bunu
  // doldurur (bkz. docs/adr/0015-production-deployment-architecture.md).
  logLevel?: string;
}

// bkz. docs/security-audit.md ORTA-2: logger açıldığında request body/header
// redaksiyonu zorunlu. Fastify'ın varsayılan request serializer'ı zaten
// body/header LOGLAMAZ (yalnızca method/url/hostname) — bu redact listesi ek
// bir güvence (ör. ileride özel bir serializer/hata logu body'yi taşırsa).
// Customer/Vehicle route'ları eklendiğinde plaka/telefon/TC alanları da
// buraya eklenmeli (CLAUDE.md kural 6, ADR 0015).
const LOG_REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "req.body.password",
  "req.body.newPassword",
];

export function buildApp(prisma: PrismaClient, config: BuildAppConfig): FastifyInstance {
  const app = Fastify({
    logger: config.logLevel
      ? { level: config.logLevel, redact: { paths: LOG_REDACT_PATHS, remove: true } }
      : false,
  });

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
  // client'tan okunmaz, login/refresh'in kendisi kimliği kurar. Davet
  // önizleme/redemption da bu kategoride (davet edilen kullanıcı henüz
  // sisteme hiç giremiyor, bkz. ADR 0011).
  registerAuthRoutes(app, { loginDb: prisma, refreshDb: prisma, jwtSecret: config.jwtSecret });
  registerInvitationRoutes(app, prisma);

  // Korumalı route'lar: authPreHandler ile request.authContext/request.tenantDb
  // set edilmeden hiçbir handler'a girilmez (bkz. docs/security-audit.md KRİTİK-0).
  registerWorkOrderRoutes(app, prisma, config.jwtSecret, config.diagServiceClient);
  registerEcuFileRoutes(app, prisma, config.jwtSecret, config.storage);
  registerFileRequestRoutes(app, prisma, config.jwtSecret);
  registerDealerAccountRoutes(app, prisma, config.jwtSecret);
  registerUserRoutes(app, prisma, config.jwtSecret, config.emailSender, config.webAppBaseUrl);
  registerInvoiceRoutes(app, prisma, config.jwtSecret);
  // Admin route'ları BİLİNÇLİ OLARAK request.tenantDb kullanmaz (bkz. ADR 0010).
  registerAdminTenantRoutes(app, prisma, config.jwtSecret, config.emailSender, config.webAppBaseUrl);

  return app;
}
