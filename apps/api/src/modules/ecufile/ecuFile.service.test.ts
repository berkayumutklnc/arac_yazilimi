import { describe, expect, it, vi } from "vitest";
import {
  createEcuFile,
  MissingStockRomReferenceError,
  StockRomReferenceNotFoundError,
  VehicleNotFoundError,
  type EcuFileDb,
} from "./ecuFile.service.js";

const tenantId = "11111111-1111-1111-1111-111111111111";
const vehicleId = "22222222-2222-2222-2222-222222222222";
const uploadedBy = "33333333-3333-3333-3333-333333333333";

function baseInput(overrides: Partial<Parameters<typeof createEcuFile>[1]> = {}) {
  return {
    tenantId,
    vehicleId,
    fileType: "STAGE1" as const,
    storageKey: "s3://ecu/stage1.bin",
    checksum: "abc123",
    uploadedBy,
    ...overrides,
  };
}

function createMockDb() {
  const create = vi.fn<EcuFileDb["ecuFile"]["create"]>();
  const findUnique = vi.fn<EcuFileDb["ecuFile"]["findUnique"]>();
  const vehicleFindUnique = vi.fn<EcuFileDb["vehicle"]["findUnique"]>();
  // Testlerin çoğu araç sahipliğini değil, stockRomRef/self-reference davranışını
  // hedefliyor — varsayılan olarak aracın çağıranın tenant'ına ait olduğunu
  // simüle ediyoruz; sahiplik testi bunu ayrıca boş döndürerek geçersiz kılar.
  vehicleFindUnique.mockResolvedValue({ id: vehicleId });
  const db: EcuFileDb = { vehicle: { findUnique: vehicleFindUnique }, ecuFile: { create, findUnique } };
  return { db, create, findUnique, vehicleFindUnique };
}

describe("createEcuFile", () => {
  it("vehicleId çağıranın tenant'ına ait değilse VehicleNotFoundError fırlatır (tenant izolasyonu)", async () => {
    const { db, create, vehicleFindUnique } = createMockDb();
    vehicleFindUnique.mockResolvedValue(null);

    await expect(createEcuFile(db, baseInput())).rejects.toBeInstanceOf(VehicleNotFoundError);
    expect(create).not.toHaveBeenCalled();
  });

  it("stockRomRef verilmeden STAGE dosyası kaydedilemez", async () => {
    const { db, create } = createMockDb();

    await expect(createEcuFile(db, baseInput())).rejects.toBeInstanceOf(
      MissingStockRomReferenceError,
    );
    expect(create).not.toHaveBeenCalled();
  });

  it("var olmayan bir stockRomRef ile STAGE dosyası kaydedilemez", async () => {
    const { db, create, findUnique } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(
      createEcuFile(db, baseInput({ stockRomRef: "does-not-exist" })),
    ).rejects.toBeInstanceOf(StockRomReferenceNotFoundError);
    expect(create).not.toHaveBeenCalled();
  });

  it("ORIGINAL_STOCK olmayan veya başka araca ait bir stockRomRef reddedilir", async () => {
    const { db, create, findUnique } = createMockDb();
    findUnique.mockResolvedValue({
      id: "stock-1",
      tenantId,
      vehicleId: "other-vehicle",
      fileType: "ORIGINAL_STOCK",
    });

    await expect(
      createEcuFile(db, baseInput({ stockRomRef: "stock-1" })),
    ).rejects.toBeInstanceOf(StockRomReferenceNotFoundError);
    expect(create).not.toHaveBeenCalled();
  });

  it("geçerli stockRomRef ile STAGE dosyası kaydedilir", async () => {
    const { db, create, findUnique } = createMockDb();
    create.mockResolvedValue({ id: "new-file" });
    findUnique.mockResolvedValue({
      id: "stock-1",
      tenantId,
      vehicleId,
      fileType: "ORIGINAL_STOCK",
    });

    await createEcuFile(db, baseInput({ stockRomRef: "stock-1" }));

    expect(create).toHaveBeenCalledWith({
      // expect.objectContaining() tipi vitest'te `any` döner (bilinen tip boşluğu).
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: expect.objectContaining({
        tenantId,
        vehicleId,
        fileType: "STAGE1",
        stockRomRef: "stock-1",
      }),
    });
  });

  it("ORIGINAL_STOCK dosyası kendi id'sine self-reference ile kaydedilir", async () => {
    const { db, create, findUnique } = createMockDb();
    create.mockResolvedValue({ id: "whatever" });

    await createEcuFile(db, baseInput({ fileType: "ORIGINAL_STOCK", stockRomRef: undefined }));

    expect(findUnique).not.toHaveBeenCalled();
    const createArgs = create.mock.calls[0]?.[0];
    expect(createArgs?.data.id).toBeTruthy();
    expect(createArgs?.data.stockRomRef).toBe(createArgs?.data.id);
  });

  it("ORIGINAL_STOCK dosyası için harici bir stockRomRef verilirse hata fırlatılır", async () => {
    const { db, create } = createMockDb();

    await expect(
      createEcuFile(db, baseInput({ fileType: "ORIGINAL_STOCK", stockRomRef: "stock-1" })),
    ).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
});
