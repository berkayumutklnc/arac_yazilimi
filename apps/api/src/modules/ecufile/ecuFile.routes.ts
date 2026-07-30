import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  requestEcuFileUpload,
  IllegalContentDetectedError,
  ChecksumMismatchError,
  DuplicateEcuFileError,
  type EcuFileStoragePort,
} from "./ecuFileUpload.service.js";
import { confirmEcuFileUploadTransactional } from "./ecuFileUploadTransactional.js";
import {
  MissingStockRomReferenceError,
  StockRomReferenceNotFoundError,
  VehicleNotFoundError,
} from "./ecuFile.service.js";
import { listEcuFilesForVehicle } from "./ecuFileList.service.js";
import {
  downloadEcuFile,
  ForbiddenRoleError,
  EcuFileNotFoundError,
  type EcuFileDownloadStoragePort,
} from "./ecuFileDownload.service.js";
import { Role, EcuFileType, AccessDeniedResource, AccessDeniedReason } from "../../generated/prisma/enums.js";
import { createAuthPreHandler } from "../../middleware/authPreHandler.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logAccessDenied } from "../../security/accessDeniedAudit.js";
import type { PrismaClient } from "../../generated/prisma/client.js";
import "../../types/fastify.js";

const ALLOWED_ROLES: readonly Role[] = [Role.OWNER, Role.ENGINEER];

const vehicleParamsSchema = z.object({ vehicleId: z.string().min(1) });
const ecuFileParamsSchema = z.object({ id: z.string().min(1) });

const uploadRequestBodySchema = z.object({ fileName: z.string().min(1).max(255) });

const uploadConfirmBodySchema = z.object({
  storageKey: z.string().min(1),
  fileType: z.nativeEnum(EcuFileType),
  claimedChecksum: z.string().min(1),
  stockRomRef: z.string().min(1).optional(),
});

export function registerEcuFileRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  jwtSecret: string,
  storage: EcuFileStoragePort & EcuFileDownloadStoragePort,
): void {
  const authPreHandler = createAuthPreHandler(prisma, jwtSecret);

  app.post(
    "/vehicles/:vehicleId/ecu-files/upload-request",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const params = vehicleParamsSchema.parse(request.params);

      if (!requireRole(request, reply, ALLOWED_ROLES)) {
        await logAccessDenied(request.tenantDb, {
          actorId: request.authContext.userId,
          actorRole: request.authContext.role,
          resource: AccessDeniedResource.ECU_FILE_UPLOAD,
          resourceId: params.vehicleId,
          reason: AccessDeniedReason.FORBIDDEN_ROLE,
        });
        return;
      }

      const body = uploadRequestBodySchema.parse(request.body);

      try {
        const result = await requestEcuFileUpload(storage, {
          tenantId: request.authContext.tenantId,
          vehicleId: params.vehicleId,
          fileName: body.fileName,
        });
        return await reply.code(200).send(result);
      } catch (err) {
        if (err instanceof IllegalContentDetectedError) {
          return reply.code(400).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.post(
    "/vehicles/:vehicleId/ecu-files/upload-confirm",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const params = vehicleParamsSchema.parse(request.params);

      if (!requireRole(request, reply, ALLOWED_ROLES)) {
        await logAccessDenied(request.tenantDb, {
          actorId: request.authContext.userId,
          actorRole: request.authContext.role,
          resource: AccessDeniedResource.ECU_FILE_UPLOAD,
          resourceId: params.vehicleId,
          reason: AccessDeniedReason.FORBIDDEN_ROLE,
        });
        return;
      }

      const body = uploadConfirmBodySchema.parse(request.body);

      try {
        const result = await confirmEcuFileUploadTransactional(
          prisma,
          request.authContext.tenantId,
          storage,
          {
            vehicleId: params.vehicleId,
            fileType: body.fileType,
            storageKey: body.storageKey,
            claimedChecksum: body.claimedChecksum,
            uploadedBy: request.authContext.userId,
            stockRomRef: body.stockRomRef,
          },
        );
        return await reply.code(201).send(result);
      } catch (err) {
        if (err instanceof ChecksumMismatchError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof MissingStockRomReferenceError || err instanceof StockRomReferenceNotFoundError) {
          return reply.code(400).send({ error: err.message });
        }
        if (err instanceof DuplicateEcuFileError) {
          return reply.code(409).send({ error: err.message, existingFileId: err.existingFileId });
        }
        if (err instanceof VehicleNotFoundError) {
          return reply.code(404).send({ error: err.message });
        }
        throw err;
      }
    },
  );

  app.get(
    "/vehicles/:vehicleId/ecu-files",
    { preHandler: authPreHandler },
    async (request, reply) => {
      const params = vehicleParamsSchema.parse(request.params);

      if (!requireRole(request, reply, ALLOWED_ROLES)) {
        await logAccessDenied(request.tenantDb, {
          actorId: request.authContext.userId,
          actorRole: request.authContext.role,
          resource: AccessDeniedResource.ECU_FILE_DOWNLOAD,
          resourceId: params.vehicleId,
          reason: AccessDeniedReason.FORBIDDEN_ROLE,
        });
        return;
      }

      const items = await listEcuFilesForVehicle(request.tenantDb, params.vehicleId);
      return reply.code(200).send({ items });
    },
  );

  app.get("/ecu-files/:id/download", { preHandler: authPreHandler }, async (request, reply) => {
    const params = ecuFileParamsSchema.parse(request.params);

    if (!requireRole(request, reply, ALLOWED_ROLES)) {
      await logAccessDenied(request.tenantDb, {
        actorId: request.authContext.userId,
        actorRole: request.authContext.role,
        resource: AccessDeniedResource.ECU_FILE_DOWNLOAD,
        resourceId: params.id,
        reason: AccessDeniedReason.FORBIDDEN_ROLE,
      });
      return;
    }

    try {
      const result = await downloadEcuFile(
        { db: request.tenantDb, storage },
        {
          ecuFileId: params.id,
          requestedBy: { id: request.authContext.userId, role: request.authContext.role },
        },
      );
      return await reply.code(200).send(result);
    } catch (err) {
      if (err instanceof ForbiddenRoleError) {
        await logAccessDenied(request.tenantDb, {
          actorId: request.authContext.userId,
          actorRole: request.authContext.role,
          resource: AccessDeniedResource.ECU_FILE_DOWNLOAD,
          resourceId: params.id,
          reason: AccessDeniedReason.FORBIDDEN_ROLE,
        });
        return reply.code(403).send({ error: err.message });
      }
      if (err instanceof EcuFileNotFoundError) {
        await logAccessDenied(request.tenantDb, {
          actorId: request.authContext.userId,
          actorRole: request.authContext.role,
          resource: AccessDeniedResource.ECU_FILE_DOWNLOAD,
          resourceId: params.id,
          reason: AccessDeniedReason.NOT_FOUND,
        });
        return reply.code(404).send({ error: err.message });
      }
      throw err;
    }
  });
}
