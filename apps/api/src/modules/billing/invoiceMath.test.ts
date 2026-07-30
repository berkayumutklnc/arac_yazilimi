import { describe, expect, it } from "vitest";
import { computeLineAmounts, roundHalfUpKurus, VAT_RATE_PERCENTAGES } from "./invoiceMath.js";

describe("VAT_RATE_PERCENTAGES", () => {
  it("Türkiye KDV dilimlerini yüzde olarak eşler", () => {
    expect(VAT_RATE_PERCENTAGES).toEqual({
      RATE_0: 0,
      RATE_1: 1,
      RATE_10: 10,
      RATE_20: 20,
    });
  });
});

describe("roundHalfUpKurus", () => {
  it.each([
    [0, 0],
    [1, 1],
    [1.4, 1],
    [1.5, 2],
    [1.49, 1],
    [2.5, 3],
    [0.5, 1],
    [149.5, 150],
  ])("roundHalfUpKurus(%s) === %s", (input, expected) => {
    expect(roundHalfUpKurus(input)).toBe(expected);
  });
});

describe("computeLineAmounts", () => {
  it("RATE_0 için KDV sıfırdır, satır toplamı net tutara eşittir", () => {
    const result = computeLineAmounts({ quantity: 3, unitPriceKurus: 10_000, vatRate: "RATE_0" });
    expect(result).toEqual({
      netAmountKurus: 30_000,
      vatAmountKurus: 0,
      lineTotalKurus: 30_000,
    });
  });

  it("tam bölünen KDV: quantity=2, unitPrice=5000, RATE_20 -> net=10000, vat=2000", () => {
    const result = computeLineAmounts({ quantity: 2, unitPriceKurus: 5_000, vatRate: "RATE_20" });
    expect(result).toEqual({
      netAmountKurus: 10_000,
      vatAmountKurus: 2_000,
      lineTotalKurus: 12_000,
    });
  });

  it("half-up sınırı: net=150, RATE_1 -> vat = 150*0.01 = 1.5 -> 2 kuruşa yuvarlanır", () => {
    const result = computeLineAmounts({ quantity: 1, unitPriceKurus: 150, vatRate: "RATE_1" });
    expect(result).toEqual({
      netAmountKurus: 150,
      vatAmountKurus: 2,
      lineTotalKurus: 152,
    });
  });

  it("half-up sınırı altı: net=140, RATE_1 -> vat = 1.4 -> 1 kuruşa yuvarlanır", () => {
    const result = computeLineAmounts({ quantity: 1, unitPriceKurus: 140, vatRate: "RATE_1" });
    expect(result).toEqual({
      netAmountKurus: 140,
      vatAmountKurus: 1,
      lineTotalKurus: 141,
    });
  });

  it("büyük miktar/adet kombinasyonu yuvarlamayı doğru uygular", () => {
    const result = computeLineAmounts({ quantity: 7, unitPriceKurus: 133_333, vatRate: "RATE_10" });
    // net = 7 * 133333 = 933331; vat = 93333.1 -> half-up -> 93333
    expect(result).toEqual({
      netAmountKurus: 933_331,
      vatAmountKurus: 93_333,
      lineTotalKurus: 1_026_664,
    });
  });
});
