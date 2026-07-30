import { describe, expect, it } from "vitest";
import { canTransition, getAllowedNextStatuses, requiresReason } from "./workOrderStatusMachine.js";

describe("canTransition", () => {
  it.each([
    ["DRAFT", "ACCEPTED"],
    ["ACCEPTED", "IN_PROGRESS"],
    ["IN_PROGRESS", "AWAITING_PARTS"],
    ["AWAITING_PARTS", "QUALITY_CHECK"],
    ["QUALITY_CHECK", "DELIVERED"],
    ["DELIVERED", "CLOSED"],
    ["QUALITY_CHECK", "IN_PROGRESS"],
    ["DRAFT", "CANCELLED"],
    ["ACCEPTED", "CANCELLED"],
    ["IN_PROGRESS", "CANCELLED"],
    ["AWAITING_PARTS", "CANCELLED"],
  ] as const)("%s -> %s geçerlidir", (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it.each([
    ["DRAFT", "IN_PROGRESS"],
    ["DELIVERED", "CANCELLED"],
    ["CLOSED", "CANCELLED"],
    ["CLOSED", "DRAFT"],
    ["CANCELLED", "DRAFT"],
  ] as const)("%s -> %s geçersizdir", (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});

describe("getAllowedNextStatuses", () => {
  it("QUALITY_CHECK için hem DELIVERED hem IN_PROGRESS (rework) döner", () => {
    expect(getAllowedNextStatuses("QUALITY_CHECK")).toEqual(["DELIVERED", "IN_PROGRESS"]);
  });

  it("CLOSED ve CANCELLED terminaldir, boş dizi döner", () => {
    expect(getAllowedNextStatuses("CLOSED")).toEqual([]);
    expect(getAllowedNextStatuses("CANCELLED")).toEqual([]);
  });
});

describe("requiresReason", () => {
  it.each([
    ["QUALITY_CHECK", "IN_PROGRESS"],
    ["DRAFT", "CANCELLED"],
    ["IN_PROGRESS", "CANCELLED"],
  ] as const)("%s -> %s için reason zorunludur", (from, to) => {
    expect(requiresReason(from, to)).toBe(true);
  });

  it.each([
    ["DRAFT", "ACCEPTED"],
    ["QUALITY_CHECK", "DELIVERED"],
  ] as const)("%s -> %s için reason zorunlu değildir", (from, to) => {
    expect(requiresReason(from, to)).toBe(false);
  });
});
