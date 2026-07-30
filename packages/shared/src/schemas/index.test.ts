import { describe, expect, it } from "vitest";
import {
  loginSchema,
  createWorkOrderSchema,
  transitionWorkOrderSchema,
  uploadRequestSchema,
  uploadConfirmSchema,
  createFileRequestSchema,
  acceptFileRequestSchema,
  fulfillFileRequestSchema,
} from "./index.js";

describe("loginSchema", () => {
  it("geçerli girdi kabul eder", () => {
    expect(
      loginSchema.safeParse({ tenantSlug: "acme", email: "a@acme.test", password: "secret" }).success,
    ).toBe(true);
  });

  it("geçersiz email'i reddeder", () => {
    expect(
      loginSchema.safeParse({ tenantSlug: "acme", email: "not-an-email", password: "secret" }).success,
    ).toBe(false);
  });
});

describe("createWorkOrderSchema", () => {
  it("vehicleId zorunludur", () => {
    expect(createWorkOrderSchema.safeParse({}).success).toBe(false);
    expect(createWorkOrderSchema.safeParse({ vehicleId: "v-1" }).success).toBe(true);
  });
});

describe("transitionWorkOrderSchema", () => {
  it("bilinmeyen bir toStatus'ü reddeder", () => {
    expect(transitionWorkOrderSchema.safeParse({ toStatus: "NOT_A_STATUS" }).success).toBe(false);
  });

  it("reason opsiyoneldir", () => {
    expect(transitionWorkOrderSchema.safeParse({ toStatus: "ACCEPTED" }).success).toBe(true);
    expect(transitionWorkOrderSchema.safeParse({ toStatus: "CANCELLED", reason: "iptal" }).success).toBe(
      true,
    );
  });
});

describe("uploadRequestSchema / uploadConfirmSchema", () => {
  it("fileName zorunludur", () => {
    expect(uploadRequestSchema.safeParse({}).success).toBe(false);
    expect(uploadRequestSchema.safeParse({ fileName: "stage1.bin" }).success).toBe(true);
  });

  it("uploadConfirm stockRomRef olmadan da geçerlidir (ORIGINAL_STOCK için)", () => {
    expect(
      uploadConfirmSchema.safeParse({
        storageKey: "k",
        fileType: "ORIGINAL_STOCK",
        claimedChecksum: "hash",
      }).success,
    ).toBe(true);
  });
});

describe("createFileRequestSchema", () => {
  it("ORIGINAL_STOCK'u stage olarak reddeder", () => {
    expect(
      createFileRequestSchema.safeParse({
        hubTenantId: "hub-1",
        vehicleId: "v-1",
        readFileId: "f-1",
        requestedStage: "ORIGINAL_STOCK",
      }).success,
    ).toBe(false);
  });

  it("geçerli bir stage talebini kabul eder", () => {
    expect(
      createFileRequestSchema.safeParse({
        hubTenantId: "hub-1",
        vehicleId: "v-1",
        readFileId: "f-1",
        requestedStage: "STAGE1",
      }).success,
    ).toBe(true);
  });
});

describe("acceptFileRequestSchema / fulfillFileRequestSchema", () => {
  it("costKurus negatif olamaz", () => {
    expect(acceptFileRequestSchema.safeParse({ costKurus: -1 }).success).toBe(false);
    expect(acceptFileRequestSchema.safeParse({ costKurus: 0 }).success).toBe(true);
  });

  it("fulfill storageKey + checksum ister", () => {
    expect(fulfillFileRequestSchema.safeParse({ storageKey: "k", checksum: "h" }).success).toBe(true);
    expect(fulfillFileRequestSchema.safeParse({ storageKey: "k" }).success).toBe(false);
  });
});
