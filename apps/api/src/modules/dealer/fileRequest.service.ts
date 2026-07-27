import { z } from "zod";
import { Role, EcuFileType } from "../../generated/prisma/enums.js";
import {
  assertValidTransition,
  type FileRequestStatus,
} from "./fileRequestStatus.machine.js";

export class ForbiddenRoleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenRoleError";
  }
}

export class DealerAccountNotFoundError extends Error {
  constructor(hubTenantId: string, dealerTenantId: string) {
    super(
      `Bu bayi ile merkez arasında bir kredi hesabı bulunamadı (hub=${hubTenantId}, dealer=${dealerTenantId}).`,
    );
    this.name = "DealerAccountNotFoundError";
  }
}

export class FileRequestNotFoundError extends Error {
  constructor(fileRequestId: string) {
    super(`Dosya talebi bulunamadı: ${fileRequestId}`);
    this.name = "FileRequestNotFoundError";
  }
}

export class MissingCostError extends Error {
  constructor() {
    super("ACCEPTED geçişinde costKurus zorunludur.");
    this.name = "MissingCostError";
  }
}

export class VehicleNotFoundError extends Error {
  constructor(vehicleId: string) {
    super(`Araç bulunamadı veya bu tenant'a ait değil: ${vehicleId}`);
    this.name = "VehicleNotFoundError";
  }
}

export interface ActingUser {
  id: string;
  tenantId: string;
  role: Role;
}

export const createFileRequestInputSchema = z.object({
  hubTenantId: z.string().min(1),
  vehicleId: z.string().min(1),
  readFileId: z.string().min(1),
  requestedStage: z
    .nativeEnum(EcuFileType)
    .refine((value) => value !== EcuFileType.ORIGINAL_STOCK, {
      message: "ORIGINAL_STOCK bir stage talebi olarak istenemez.",
    }),
});

export type CreateFileRequestInput = z.infer<typeof createFileRequestInputSchema>;

interface DealerAccountRecord {
  id: string;
  hubTenantId: string;
  dealerTenantId: string;
  creditBalanceKurus: number;
}

interface FileRequestRecord {
  id: string;
  hubTenantId: string;
  dealerTenantId: string;
  status: FileRequestStatus;
}

interface FileRequestCreateData {
  hubTenantId: string;
  dealerTenantId: string;
  dealerAccountId: string;
  vehicleId: string;
  readFileId: string;
  requestedStage: EcuFileType;
  status: FileRequestStatus;
  requestedBy: string;
}

interface FileRequestUpdateData {
  status: FileRequestStatus;
  processedBy: string;
  costKurus?: number;
}

interface FileRequestAuditData {
  fileRequestId: string;
  hubTenantId: string;
  dealerTenantId: string;
  fromStatus: FileRequestStatus;
  toStatus: FileRequestStatus;
  changedBy: string;
}

export interface FileRequestDb {
  // Güvenlik (bkz. docs/security-audit.md, KRİTİK-2): vehicleId'nin gerçekten
  // dealerTenantId'ye ait olduğunu doğrulamadan talep ASLA oluşturulmaz.
  vehicle: {
    findUnique: (args: { where: { id: string; tenantId: string } }) => Promise<{ id: string } | null>;
  };
  dealerAccount: {
    findFirst: (args: {
      where: { hubTenantId: string; dealerTenantId: string };
    }) => Promise<DealerAccountRecord | null>;
  };
  fileRequest: {
    create: (args: { data: FileRequestCreateData }) => Promise<{ id: string }>;
    findUnique: (args: { where: { id: string } }) => Promise<FileRequestRecord | null>;
    update: (args: { where: { id: string }; data: FileRequestUpdateData }) => Promise<unknown>;
  };
  fileRequestStatusAuditLog: {
    create: (args: { data: FileRequestAuditData }) => Promise<unknown>;
  };
}

const HUB_ALLOWED_ROLES: readonly Role[] = [Role.OWNER, Role.ENGINEER];

export async function createFileRequest(
  db: FileRequestDb,
  actingUser: ActingUser,
  rawInput: CreateFileRequestInput,
) {
  if (actingUser.role !== Role.DEALER) {
    throw new ForbiddenRoleError(
      `Rol "${actingUser.role}" dosya talebi açamaz; yalnızca DEALER yetkilidir.`,
    );
  }

  const input = createFileRequestInputSchema.parse(rawInput);
  const dealerTenantId = actingUser.tenantId;

  const vehicle = await db.vehicle.findUnique({
    where: { id: input.vehicleId, tenantId: dealerTenantId },
  });
  if (!vehicle) {
    throw new VehicleNotFoundError(input.vehicleId);
  }

  const dealerAccount = await db.dealerAccount.findFirst({
    where: { hubTenantId: input.hubTenantId, dealerTenantId },
  });
  if (!dealerAccount) {
    throw new DealerAccountNotFoundError(input.hubTenantId, dealerTenantId);
  }

  return db.fileRequest.create({
    data: {
      hubTenantId: input.hubTenantId,
      dealerTenantId,
      dealerAccountId: dealerAccount.id,
      vehicleId: input.vehicleId,
      readFileId: input.readFileId,
      requestedStage: input.requestedStage,
      status: "PENDING",
      requestedBy: actingUser.id,
    },
  });
}

export interface TransitionFileRequestParams {
  fileRequestId: string;
  hubTenantId: string;
  toStatus: FileRequestStatus;
  actingUser: ActingUser;
  costKurus?: number;
}

export async function transitionFileRequestStatus(
  db: FileRequestDb,
  params: TransitionFileRequestParams,
): Promise<void> {
  const isHubUser =
    HUB_ALLOWED_ROLES.includes(params.actingUser.role) &&
    params.actingUser.tenantId === params.hubTenantId;
  if (!isHubUser) {
    throw new ForbiddenRoleError(
      `Rol "${params.actingUser.role}" bu talebi işleyemez; yalnızca merkez tenant'ın OWNER/ENGINEER kullanıcıları yetkilidir.`,
    );
  }

  const fileRequest = await db.fileRequest.findUnique({ where: { id: params.fileRequestId } });
  if (!fileRequest || fileRequest.hubTenantId !== params.hubTenantId) {
    throw new FileRequestNotFoundError(params.fileRequestId);
  }

  assertValidTransition(fileRequest.status, params.toStatus);

  if (params.toStatus === "ACCEPTED" && params.costKurus === undefined) {
    throw new MissingCostError();
  }

  await db.fileRequest.update({
    where: { id: fileRequest.id },
    data: {
      status: params.toStatus,
      processedBy: params.actingUser.id,
      ...(params.costKurus !== undefined ? { costKurus: params.costKurus } : {}),
    },
  });

  await db.fileRequestStatusAuditLog.create({
    data: {
      fileRequestId: fileRequest.id,
      hubTenantId: params.hubTenantId,
      dealerTenantId: fileRequest.dealerTenantId,
      fromStatus: fileRequest.status,
      toStatus: params.toStatus,
      changedBy: params.actingUser.id,
    },
  });
}
