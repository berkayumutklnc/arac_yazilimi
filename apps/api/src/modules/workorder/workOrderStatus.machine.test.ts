import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  canTransition,
  requiresReason,
  InvalidWorkOrderTransitionError,
  WORK_ORDER_STATUS_ORDER,
} from "./workOrderStatus.machine.js";

describe("WorkOrder durum makinesi", () => {
  it("geçerli durumların tam kümesini tanımlar: ana zincir + CANCELLED", () => {
    expect(WORK_ORDER_STATUS_ORDER).toEqual([
      "DRAFT",
      "ACCEPTED",
      "IN_PROGRESS",
      "AWAITING_PARTS",
      "QUALITY_CHECK",
      "DELIVERED",
      "CLOSED",
      "CANCELLED",
    ]);
  });

  it.each([
    ["DRAFT", "ACCEPTED"],
    ["ACCEPTED", "IN_PROGRESS"],
    ["IN_PROGRESS", "AWAITING_PARTS"],
    ["AWAITING_PARTS", "QUALITY_CHECK"],
    ["QUALITY_CHECK", "DELIVERED"],
    ["DELIVERED", "CLOSED"],
    // Rework: kalite kontrolden başarısız çıkan iş tekrar üretime döner.
    ["QUALITY_CHECK", "IN_PROGRESS"],
    // İptal: yalnızca DELIVERED/CLOSED öncesindeki durumlardan.
    ["DRAFT", "CANCELLED"],
    ["ACCEPTED", "CANCELLED"],
    ["IN_PROGRESS", "CANCELLED"],
    ["AWAITING_PARTS", "CANCELLED"],
  ] as const)("%s -> %s geçerli bir geçiştir", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it("CLOSED terminal durumdur, hiçbir yere geçemez", () => {
    expect(canTransition("CLOSED", "DRAFT")).toBe(false);
    expect(canTransition("CLOSED", "IN_PROGRESS")).toBe(false);
    expect(canTransition("CLOSED", "CANCELLED")).toBe(false);
  });

  it("CANCELLED terminal durumdur, hiçbir yere geçemez", () => {
    expect(canTransition("CANCELLED", "DRAFT")).toBe(false);
    expect(canTransition("CANCELLED", "IN_PROGRESS")).toBe(false);
  });

  it.each([
    ["DRAFT", "IN_PROGRESS"],
    ["DRAFT", "CLOSED"],
    ["IN_PROGRESS", "DRAFT"],
    ["IN_PROGRESS", "QUALITY_CHECK"],
    ["DELIVERED", "QUALITY_CHECK"],
    // DELIVERED/CLOSED'dan iptal yok — teslim edilmiş/kapanmış iş geri alınamaz.
    ["DELIVERED", "CANCELLED"],
    ["CLOSED", "CANCELLED"],
  ] as const)("%s -> %s geçersiz bir geçiştir", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertValidTransition(from, to)).toThrow(InvalidWorkOrderTransitionError);
  });

  it("geçersiz geçiş hatası önceki ve yeni durumu taşır", () => {
    try {
      assertValidTransition("DRAFT", "CLOSED");
      throw new Error("hata fırlatılmalıydı");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidWorkOrderTransitionError);
      const transitionError = err as InvalidWorkOrderTransitionError;
      expect(transitionError.from).toBe("DRAFT");
      expect(transitionError.to).toBe("CLOSED");
    }
  });
});

describe("requiresReason", () => {
  it.each([
    ["QUALITY_CHECK", "IN_PROGRESS"],
    ["DRAFT", "CANCELLED"],
    ["ACCEPTED", "CANCELLED"],
    ["IN_PROGRESS", "CANCELLED"],
    ["AWAITING_PARTS", "CANCELLED"],
  ] as const)("%s -> %s için reason zorunludur", (from, to) => {
    expect(requiresReason(from, to)).toBe(true);
  });

  it.each([
    ["DRAFT", "ACCEPTED"],
    ["ACCEPTED", "IN_PROGRESS"],
    ["IN_PROGRESS", "AWAITING_PARTS"],
    ["AWAITING_PARTS", "QUALITY_CHECK"],
    ["QUALITY_CHECK", "DELIVERED"],
    ["DELIVERED", "CLOSED"],
  ] as const)("%s -> %s normal zincir geçişinde reason zorunlu değildir", (from, to) => {
    expect(requiresReason(from, to)).toBe(false);
  });
});
