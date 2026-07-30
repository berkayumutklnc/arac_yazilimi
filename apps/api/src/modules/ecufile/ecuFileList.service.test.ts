import { describe, expect, it, vi } from "vitest";
import { listEcuFilesForVehicle, type EcuFileListDb } from "./ecuFileList.service.js";
import { EcuFileType } from "../../generated/prisma/enums.js";

const vehicleId = "vehicle-1";

describe("listEcuFilesForVehicle", () => {
  it("aracın (tenant-scoped) tüm ECU dosyalarını döner", async () => {
    const findMany = vi.fn<EcuFileListDb["ecuFile"]["findMany"]>();
    const stockId = "stock-1";
    findMany.mockResolvedValue([
      {
        id: stockId,
        fileType: EcuFileType.ORIGINAL_STOCK,
        stockRomRef: stockId,
        checksum: "stock-hash",
        uploadedBy: "user-1",
        createdAt: new Date("2026-01-01"),
      },
      {
        id: "stage-1",
        fileType: EcuFileType.STAGE1,
        stockRomRef: stockId,
        checksum: "stage-hash",
        uploadedBy: "user-2",
        createdAt: new Date("2026-01-02"),
      },
    ]);
    const db: EcuFileListDb = { ecuFile: { findMany } };

    const result = await listEcuFilesForVehicle(db, vehicleId);

    expect(findMany).toHaveBeenCalledWith({ where: { vehicleId } });
    expect(result).toHaveLength(2);
  });

  it("araca ait dosya yoksa boş dizi döner", async () => {
    const findMany = vi.fn<EcuFileListDb["ecuFile"]["findMany"]>();
    findMany.mockResolvedValue([]);
    const db: EcuFileListDb = { ecuFile: { findMany } };

    const result = await listEcuFilesForVehicle(db, vehicleId);

    expect(result).toEqual([]);
  });
});
