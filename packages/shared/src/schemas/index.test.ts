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
  createTenantSchema,
  inviteUserSchema,
  changeUserRoleSchema,
  redeemInvitationSchema,
  proposeDealerLinkSchema,
  respondDealerLinkSchema,
  creditTopUpSchema,
  addWorkOrderItemSchema,
  voidInvoiceSchema,
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

describe("createTenantSchema", () => {
  it("name/slug/ownerEmail zorunludur", () => {
    expect(createTenantSchema.safeParse({ name: "Acme", slug: "acme", ownerEmail: "a@acme.test" }).success).toBe(
      true,
    );
    expect(createTenantSchema.safeParse({ name: "Acme", slug: "acme" }).success).toBe(false);
    expect(
      createTenantSchema.safeParse({ name: "Acme", slug: "acme", ownerEmail: "not-an-email" }).success,
    ).toBe(false);
  });
});

describe("inviteUserSchema / changeUserRoleSchema", () => {
  it("SUPER_ADMIN'i davet edilebilir/atanabilir rol olarak reddeder", () => {
    expect(inviteUserSchema.safeParse({ email: "a@acme.test", role: "SUPER_ADMIN" }).success).toBe(false);
    expect(changeUserRoleSchema.safeParse({ role: "SUPER_ADMIN" }).success).toBe(false);
  });

  it("OWNER dahil diğer rolleri kabul eder (çok-OWNER'lı tenant desteklenir)", () => {
    expect(inviteUserSchema.safeParse({ email: "a@acme.test", role: "OWNER" }).success).toBe(true);
    expect(changeUserRoleSchema.safeParse({ role: "ENGINEER" }).success).toBe(true);
  });
});

describe("redeemInvitationSchema", () => {
  it("newPassword en az 8 karakter olmalıdır", () => {
    expect(redeemInvitationSchema.safeParse({ token: "t", newPassword: "short" }).success).toBe(false);
    expect(redeemInvitationSchema.safeParse({ token: "t", newPassword: "uzun-sifre-123" }).success).toBe(true);
  });
});

describe("proposeDealerLinkSchema / respondDealerLinkSchema", () => {
  it("dealerTenantSlug zorunludur", () => {
    expect(proposeDealerLinkSchema.safeParse({}).success).toBe(false);
    expect(proposeDealerLinkSchema.safeParse({ dealerTenantSlug: "dealer" }).success).toBe(true);
  });

  it("approve boolean olmalıdır", () => {
    expect(respondDealerLinkSchema.safeParse({ approve: true }).success).toBe(true);
    expect(respondDealerLinkSchema.safeParse({ approve: "yes" }).success).toBe(false);
  });
});

describe("creditTopUpSchema", () => {
  it("sıfır veya negatif tutarı reddeder", () => {
    expect(creditTopUpSchema.safeParse({ amountKurus: 0 }).success).toBe(false);
    expect(creditTopUpSchema.safeParse({ amountKurus: -100 }).success).toBe(false);
    expect(creditTopUpSchema.safeParse({ amountKurus: 500 }).success).toBe(true);
  });
});

describe("addWorkOrderItemSchema", () => {
  it("geçerli bir kalemi kabul eder, serviceTypeId opsiyoneldir", () => {
    expect(
      addWorkOrderItemSchema.safeParse({
        itemType: "SERVICE",
        description: "Yağ değişimi",
        quantity: 1,
        unitPriceKurus: 10000,
        vatRate: "RATE_20",
      }).success,
    ).toBe(true);
  });

  it("quantity/unitPriceKurus pozitif tam sayı olmalıdır", () => {
    expect(
      addWorkOrderItemSchema.safeParse({
        itemType: "PART",
        description: "Fren balatası",
        quantity: 0,
        unitPriceKurus: 10000,
        vatRate: "RATE_20",
      }).success,
    ).toBe(false);
  });

  it("bilinmeyen vatRate'i reddeder", () => {
    expect(
      addWorkOrderItemSchema.safeParse({
        itemType: "SERVICE",
        description: "x",
        quantity: 1,
        unitPriceKurus: 100,
        vatRate: "RATE_5",
      }).success,
    ).toBe(false);
  });
});

describe("voidInvoiceSchema", () => {
  it("reason zorunludur", () => {
    expect(voidInvoiceSchema.safeParse({}).success).toBe(false);
    expect(voidInvoiceSchema.safeParse({ reason: "Müşteri iptal etti" }).success).toBe(true);
  });
});
