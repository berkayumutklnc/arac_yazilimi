import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EcuFileType } from "../../generated/prisma/enums.js";

export const createEcuFileInputSchema = z.object({
  vehicleId: z.string().min(1),
  fileType: z.nativeEnum(EcuFileType),
  storageKey: z.string().min(1),
  checksum: z.string().min(1),
  uploadedBy: z.string().min(1),
  stockRomRef: z.string().min(1).optional(),
});

export type CreateEcuFileInput = z.infer<typeof createEcuFileInputSchema>;

export class MissingStockRomReferenceError extends Error {
  constructor() {
    super("Stage/custom ECU dosyası stock ROM referansı olmadan kaydedilemez.");
    this.name = "MissingStockRomReferenceError";
  }
}

export class StockRomReferenceNotFoundError extends Error {
  constructor(stockRomRef: string) {
    super(
      `stockRomRef bulunamadı veya bu araca ait bir orijinal stock dosyası değil: ${stockRomRef}`,
    );
    this.name = "StockRomReferenceNotFoundError";
  }
}

export class VehicleNotFoundError extends Error {
  constructor(vehicleId: string) {
    super(`Araç bulunamadı veya bu tenant'a ait değil: ${vehicleId}`);
    this.name = "VehicleNotFoundError";
  }
}

export interface EcuFileRecord {
  id: string;
  vehicleId: string;
  fileType: EcuFileType;
}

export interface EcuFileCreateData {
  id?: string;
  vehicleId: string;
  fileType: EcuFileType;
  storageKey: string;
  checksum: string;
  uploadedBy: string;
  stockRomRef: string;
}

// tenantId bilinçli olarak yok — db, request başına tenant-scoped oluşturulur
// (bkz. db/tenantScopedDb.ts, ADR 0006). Vehicle da otomatik-scope listesinde
// olduğu için `vehicle.findUnique({where:{id}})` zaten yalnızca çağıranın
// tenant'ındaki aracı bulabilir.
export interface EcuFileDb {
  vehicle: {
    findUnique: (args: { where: { id: string } }) => Promise<{ id: string } | null>;
  };
  ecuFile: {
    create: (args: { data: EcuFileCreateData }) => Promise<{ id: string }>;
    findUnique: (args: { where: { id: string } }) => Promise<EcuFileRecord | null>;
  };
}

export async function createEcuFile(db: EcuFileDb, rawInput: CreateEcuFileInput) {
  const input = createEcuFileInputSchema.parse(rawInput);

  const vehicle = await db.vehicle.findUnique({ where: { id: input.vehicleId } });
  if (!vehicle) {
    throw new VehicleNotFoundError(input.vehicleId);
  }

  if (input.fileType === EcuFileType.ORIGINAL_STOCK) {
    if (input.stockRomRef) {
      throw new Error(
        "ORIGINAL_STOCK dosyası harici bir stockRomRef alamaz; kendine referans otomatik atanır.",
      );
    }
    const id = randomUUID();
    return db.ecuFile.create({
      data: {
        id,
        vehicleId: input.vehicleId,
        fileType: input.fileType,
        storageKey: input.storageKey,
        checksum: input.checksum,
        uploadedBy: input.uploadedBy,
        stockRomRef: id,
      },
    });
  }

  if (!input.stockRomRef) {
    throw new MissingStockRomReferenceError();
  }

  const stockRom = await db.ecuFile.findUnique({ where: { id: input.stockRomRef } });
  const isValidStockRom =
    stockRom !== null &&
    stockRom.fileType === EcuFileType.ORIGINAL_STOCK &&
    stockRom.vehicleId === input.vehicleId;

  if (!isValidStockRom) {
    throw new StockRomReferenceNotFoundError(input.stockRomRef);
  }

  return db.ecuFile.create({
    data: {
      vehicleId: input.vehicleId,
      fileType: input.fileType,
      storageKey: input.storageKey,
      checksum: input.checksum,
      uploadedBy: input.uploadedBy,
      stockRomRef: input.stockRomRef,
    },
  });
}
