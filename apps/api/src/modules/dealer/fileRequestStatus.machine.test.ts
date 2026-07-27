import { describe, expect, it } from "vitest";
import {
  assertValidTransition,
  canTransition,
  InvalidFileRequestTransitionError,
} from "./fileRequestStatus.machine.js";

describe("FileRequest durum makinesi", () => {
  it.each([
    ["PENDING", "ACCEPTED"],
    ["PENDING", "REJECTED"],
    ["ACCEPTED", "IN_PROGRESS"],
    ["ACCEPTED", "REJECTED"],
    ["IN_PROGRESS", "FULFILLED"],
  ] as const)("%s -> %s geçerli bir geçiştir", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertValidTransition(from, to)).not.toThrow();
  });

  it.each([
    ["FULFILLED", "PENDING"],
    ["FULFILLED", "IN_PROGRESS"],
    ["REJECTED", "PENDING"],
    ["REJECTED", "ACCEPTED"],
  ] as const)("%s terminal durumdur, %s dahil hiçbir yere geçemez", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it.each([
    ["PENDING", "IN_PROGRESS"],
    ["PENDING", "FULFILLED"],
    ["ACCEPTED", "FULFILLED"],
    ["ACCEPTED", "PENDING"],
    ["IN_PROGRESS", "REJECTED"],
    ["IN_PROGRESS", "ACCEPTED"],
  ] as const)("%s -> %s geçersiz bir geçiştir", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertValidTransition(from, to)).toThrow(InvalidFileRequestTransitionError);
  });

  it("geçersiz geçiş hatası önceki ve yeni durumu taşır", () => {
    try {
      assertValidTransition("PENDING", "FULFILLED");
      throw new Error("hata fırlatılmalıydı");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidFileRequestTransitionError);
      const transitionError = err as InvalidFileRequestTransitionError;
      expect(transitionError.from).toBe("PENDING");
      expect(transitionError.to).toBe("FULFILLED");
    }
  });
});
