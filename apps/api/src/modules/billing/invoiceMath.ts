import type { VatRate } from "../../generated/prisma/enums.js";

// bkz. ADR 0014 — Türkiye KDV dilimleri.
export const VAT_RATE_PERCENTAGES: Record<VatRate, number> = {
  RATE_0: 0,
  RATE_1: 1,
  RATE_10: 10,
  RATE_20: 20,
};

// Tüm tutarlar negatif olmayan kuruş-integer (CLAUDE.md kural 8) — bu formül
// yalnızca bu aralıkta standart "yarısı ve üzeri yukarı" kuralını uygular.
export function roundHalfUpKurus(value: number): number {
  return Math.floor(value + 0.5);
}

export interface ComputeLineAmountsParams {
  quantity: number;
  unitPriceKurus: number;
  vatRate: VatRate;
}

export interface LineAmounts {
  netAmountKurus: number;
  vatAmountKurus: number;
  lineTotalKurus: number;
}

export function computeLineAmounts({ quantity, unitPriceKurus, vatRate }: ComputeLineAmountsParams): LineAmounts {
  // İki tam sayının çarpımı — yuvarlama gerekmez.
  const netAmountKurus = quantity * unitPriceKurus;
  // Kesirli kuruş ortaya çıkabilecek tek adım (bkz. ADR 0014).
  const vatAmountKurus = roundHalfUpKurus((netAmountKurus * VAT_RATE_PERCENTAGES[vatRate]) / 100);
  return {
    netAmountKurus,
    vatAmountKurus,
    lineTotalKurus: netAmountKurus + vatAmountKurus,
  };
}
