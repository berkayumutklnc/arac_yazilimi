import type { EcuFileType } from "../../generated/prisma/enums.js";

export interface EcuFileListItem {
  id: string;
  fileType: EcuFileType;
  // ORIGINAL_STOCK dosyası kendine referans verir (bkz. ecuFile.service.ts) —
  // istemci bu alanı kullanarak stock/stage ağacını kurar: id === stockRomRef
  // olan kök, diğerleri onun çocuğu.
  stockRomRef: string;
  checksum: string;
  uploadedBy: string;
  createdAt: Date;
}

// tenantId bilinçli olarak yok — db, request başına tenant-scoped oluşturulur
// (bkz. db/tenantScopedDb.ts, ADR 0006). EcuFile otomatik-scope listesinde
// olduğu için bu sorgu yalnızca çağıranın tenant'ındaki dosyaları döner —
// vehicleId başka bir tenant'a aitse (veya hiç yoksa) sonuç sessizce boş
// dizidir (liste endpoint'i için 404 yerine bu, mevcut REST desenle tutarlı).
export interface EcuFileListDb {
  ecuFile: {
    findMany: (args: { where: { vehicleId: string } }) => Promise<EcuFileListItem[]>;
  };
}

export async function listEcuFilesForVehicle(
  db: EcuFileListDb,
  vehicleId: string,
): Promise<EcuFileListItem[]> {
  return db.ecuFile.findMany({ where: { vehicleId } });
}
