import { randomUUID } from "node:crypto";
import { z } from "zod";
import { EcuFileType } from "../../generated/prisma/enums.js";

export const createEcuFileInputSchema = z.object({
  tenantId: z.string().min(1),
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

export interface EcuFileRecord {
  id: string;
  tenantId: string;
  vehicleId: string;
  fileType: EcuFileType;
}

export interface EcuFileCreateData {
  id?: string;
  tenantId: string;
  vehicleId: string;
  fileType: EcuFileType;
  storageKey: string;
  checksum: string;
  uploadedBy: string;
  stockRomRef: string;
}

export interface EcuFileDb {
  ecuFile: {
    create: (args: { data: EcuFileCreateData }) => Promise<{ id: string }>;
    findUnique: (args: { where: { id: string } }) => Promise<EcuFileRecord | null>;
  };
}

export async function createEcuFile(db: EcuFileDb, rawInput: CreateEcuFileInput) {
  const input = createEcuFileInputSchema.parse(rawInput);

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
        tenantId: input.tenantId,
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
    stockRom.tenantId === input.tenantId &&
    stockRom.vehicleId === input.vehicleId;

  if (!isValidStockRom) {
    throw new StockRomReferenceNotFoundError(input.stockRomRef);
  }

  return db.ecuFile.create({
    data: {
      tenantId: input.tenantId,
      vehicleId: input.vehicleId,
      fileType: input.fileType,
      storageKey: input.storageKey,
      checksum: input.checksum,
      uploadedBy: input.uploadedBy,
      stockRomRef: input.stockRomRef,
    },
  });
}
