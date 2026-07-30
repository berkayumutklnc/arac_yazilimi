import { describe, expect, it } from "vitest";
import { dtcParseResponseSchema, wotAnalysisResponseSchema } from "./diagServiceContract.js";

describe("dtcParseResponseSchema", () => {
  it("geçerli bir DtcParseResponse'u kabul eder", () => {
    const result = dtcParseResponseSchema.safeParse({
      matches: [{ code: "P0300", description: "Rastgele ateşleme hatası", known: true }],
      unknown_codes: ["P9999"],
    });
    expect(result.success).toBe(true);
  });

  it("beklenmeyen bir alan eksikse reddeder", () => {
    const result = dtcParseResponseSchema.safeParse({ matches: [] });
    expect(result.success).toBe(false);
  });

  it("description null olabilir", () => {
    const result = dtcParseResponseSchema.safeParse({
      matches: [{ code: "P0300", description: null, known: false }],
      unknown_codes: [],
    });
    expect(result.success).toBe(true);
  });
});

describe("wotAnalysisResponseSchema", () => {
  it("geçerli bir WotAnalysisResponse'u kabul eder", () => {
    const result = wotAnalysisResponseSchema.safeParse({
      row_count: 120,
      findings: [
        {
          rule_id: "rpm-over-limit",
          severity: "high",
          message: "RPM sınırı aşıldı",
          row_index: 42,
          details: { rpm: 7200 },
        },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("sözleşme dışı bir yanıtı (ör. diag-service sürüm uyuşmazlığı) reddeder", () => {
    const result = wotAnalysisResponseSchema.safeParse({ rowCount: 120, findings: [] });
    expect(result.success).toBe(false);
  });
});
