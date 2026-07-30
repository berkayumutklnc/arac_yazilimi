import { describe, expect, it } from "vitest";
import { canTransition, getAllowedNextStatuses, requiresReason } from "./invoiceStatusMachine.js";

describe("canTransition", () => {
  it.each([
    ["DRAFT", "ISSUED"],
    ["ISSUED", "PAID"],
    ["ISSUED", "VOID"],
  ] as const)("%s -> %s geçerlidir", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["DRAFT", "PAID"],
    ["DRAFT", "VOID"],
    ["PAID", "ISSUED"],
    ["VOID", "ISSUED"],
  ] as const)("%s -> %s geçersizdir", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("getAllowedNextStatuses", () => {
  it("ISSUED için hem PAID hem VOID döner", () => {
    expect(getAllowedNextStatuses("ISSUED")).toEqual(["PAID", "VOID"]);
  });

  it("PAID ve VOID terminaldir, boş dizi döner", () => {
    expect(getAllowedNextStatuses("PAID")).toEqual([]);
    expect(getAllowedNextStatuses("VOID")).toEqual([]);
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
