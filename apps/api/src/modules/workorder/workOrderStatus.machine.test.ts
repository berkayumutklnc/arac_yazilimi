import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  canTransition,
  InvalidWorkOrderTransitionError,
  WORK_ORDER_STATUS_ORDER,
} from "./workOrderStatus.machine.js";

describe("WorkOrder durum makinesi", () => {
  it("tam sıralı zinciri tanımlar: draft → accepted → in_progress → awaiting_parts → quality_check → delivered → closed", () => {
    expect(WORK_ORDER_STATUS_ORDER).toEqual([
      "DRAFT",
      "ACCEPTED",
      "IN_PROGRESS",
      "AWAITING_PARTS",
      "QUALITY_CHECK",
      "DELIVERED",
      "CLOSED",
    ]);
  });

  it.each([
    ["DRAFT", "ACCEPTED"],
    ["ACCEPTED", "IN_PROGRESS"],
    ["IN_PROGRESS", "AWAITING_PARTS"],
    ["AWAITING_PARTS", "QUALITY_CHECK"],
    ["QUALITY_CHECK", "DELIVERED"],
    ["DELIVERED", "CLOSED"],
  ] as const)("%s -> %s geçerli bir geçiştir", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it("CLOSED terminal durumdur, hiçbir yere geçemez", () => {
    expect(canTransition("CLOSED", "DRAFT")).toBe(false);
    expect(canTransition("CLOSED", "IN_PROGRESS")).toBe(false);
  });

  it.each([
    ["DRAFT", "IN_PROGRESS"],
    ["DRAFT", "CLOSED"],
    ["IN_PROGRESS", "DRAFT"],
    ["IN_PROGRESS", "QUALITY_CHECK"],
    ["QUALITY_CHECK", "IN_PROGRESS"],
    ["DELIVERED", "QUALITY_CHECK"],
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
