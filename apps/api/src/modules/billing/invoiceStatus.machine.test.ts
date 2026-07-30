import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  canTransition,
  requiresReason,
  InvalidInvoiceTransitionError,
  INVOICE_STATUS_ORDER,
} from "./invoiceStatus.machine.js";

describe("Invoice durum makinesi", () => {
  it("geçerli durumların tam kümesini tanımlar", () => {
    expect(INVOICE_STATUS_ORDER).toEqual(["DRAFT", "ISSUED", "PAID", "VOID"]);
  });

  it.each([
    ["DRAFT", "ISSUED"],
    ["ISSUED", "PAID"],
    ["ISSUED", "VOID"],
  ] as const)("%s -> %s geçerli bir geçiştir", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it.each(["PAID", "VOID"] as const)("%s terminal durumdur, hiçbir yere geçemez", (from) => {
    expect(canTransition(from, "DRAFT")).toBe(false);
    expect(canTransition(from, "ISSUED")).toBe(false);
    expect(canTransition(from, "PAID")).toBe(false);
    expect(canTransition(from, "VOID")).toBe(false);
  });

  it.each([
    ["DRAFT", "PAID"],
    ["DRAFT", "VOID"],
    ["PAID", "ISSUED"],
    ["VOID", "ISSUED"],
  ] as const)("%s -> %s geçersiz bir geçiştir", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertValidTransition(from, to)).toThrow(InvalidInvoiceTransitionError);
  });

  it("geçersiz geçiş hatası önceki ve yeni durumu taşır", () => {
    try {
      assertValidTransition("DRAFT", "PAID");
      throw new Error("hata fırlatılmalıydı");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidInvoiceTransitionError);
      const transitionError = err as InvalidInvoiceTransitionError;
      expect(transitionError.from).toBe("DRAFT");
      expect(transitionError.to).toBe("PAID");
    }
  });
});

describe("requiresReason", () => {
  it("yalnızca VOID'e geçişte zorunludur", () => {
    expect(requiresReason("ISSUED", "VOID")).toBe(true);
  });

  it.each([
    ["DRAFT", "ISSUED"],
    ["ISSUED", "PAID"],
  ] as const)("%s -> %s için reason zorunlu değildir", (from, to) => {
    expect(requiresReason(from, to)).toBe(false);
  });
});
