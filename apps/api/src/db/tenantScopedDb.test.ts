import { describe, expect, it } from "vitest";
import { applyTenantScope, CrossTenantAccessError } from "./tenantScopedDb.js";

const tenantId = "tenant-1";

describe("applyTenantScope — kapsam dışı modeller", () => {
  it("DealerAccount gibi iki-tenant modellerine hiç dokunmaz", () => {
    const args = { where: { hubTenantId: "hub-1", dealerTenantId: "dealer-1" } };
    expect(applyTenantScope("DealerAccount", "findFirst", args, tenantId)).toBe(args);
  });

  it("FileRequest'e hiç dokunmaz", () => {
    const args = { where: { id: "req-1" } };
    expect(applyTenantScope("FileRequest", "findUnique", args, tenantId)).toEqual(args);
    expect(applyTenantScope("FileRequest", "findUnique", args, tenantId).where).not.toHaveProperty(
      "tenantId",
    );
  });
});

describe("applyTenantScope — okuma/where operasyonları", () => {
  it("where'de tenantId yoksa enjekte eder", () => {
    const result = applyTenantScope("WorkOrder", "findUnique", { where: { id: "wo-1" } }, tenantId);
    expect(result.where).toEqual({ id: "wo-1", tenantId });
  });

  it.each(["findMany", "update", "updateMany", "delete", "deleteMany", "upsert", "count"])(
    "%s operasyonunda da where'e tenantId enjekte eder",
    (operation) => {
      const result = applyTenantScope("Vehicle", operation, { where: { id: "v-1" } }, tenantId);
      expect(result.where).toMatchObject({ tenantId });
    },
  );

  it("where zaten doğru tenantId içeriyorsa değiştirmeden kabul eder", () => {
    const result = applyTenantScope(
      "Customer",
      "findUnique",
      { where: { id: "c-1", tenantId } },
      tenantId,
    );
    expect(result.where).toEqual({ id: "c-1", tenantId });
  });

  it("where'de FARKLI bir tenantId varsa CrossTenantAccessError fırlatır (kötü niyetli komşu tenant girişimi)", () => {
    expect(() =>
      applyTenantScope(
        "EcuFile",
        "findUnique",
        { where: { id: "file-1", tenantId: "someone-elses-tenant" } },
        tenantId,
      ),
    ).toThrow(CrossTenantAccessError);
  });

  it("where hiç verilmemişse boş where + tenantId ile oluşturur", () => {
    const result = applyTenantScope("WorkOrder", "findMany", {}, tenantId);
    expect(result.where).toEqual({ tenantId });
  });
});

describe("applyTenantScope — create operasyonları", () => {
  it("create: data'da tenantId yoksa enjekte eder", () => {
    const result = applyTenantScope(
      "EcuFile",
      "create",
      { data: { vehicleId: "v-1", fileType: "STAGE1" } },
      tenantId,
    );
    expect(result.data).toMatchObject({ vehicleId: "v-1", tenantId });
  });

  it("create: data'da FARKLI bir tenantId varsa CrossTenantAccessError fırlatır", () => {
    expect(() =>
      applyTenantScope("EcuFile", "create", { data: { tenantId: "other-tenant" } }, tenantId),
    ).toThrow(CrossTenantAccessError);
  });

  it("createMany: her satıra tenantId enjekte eder", () => {
    const result = applyTenantScope(
      "WorkOrder",
      "createMany",
      { data: [{ vehicleId: "v-1" }, { vehicleId: "v-2" }] },
      tenantId,
    );
    expect(result.data).toEqual([
      { vehicleId: "v-1", tenantId },
      { vehicleId: "v-2", tenantId },
    ]);
  });

  it("createMany: satırlardan biri farklı tenantId taşıyorsa CrossTenantAccessError fırlatır", () => {
    expect(() =>
      applyTenantScope(
        "WorkOrder",
        "createMany",
        { data: [{ vehicleId: "v-1" }, { vehicleId: "v-2", tenantId: "other-tenant" }] },
        tenantId,
      ),
    ).toThrow(CrossTenantAccessError);
  });
});
