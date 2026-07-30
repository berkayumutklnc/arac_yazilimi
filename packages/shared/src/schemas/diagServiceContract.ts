import { z } from "zod";

// packages/shared/openapi/diag-service.json'ı (openapi-typescript'in ürettiği
// TİPLERE ek olarak) ÇALIŞMA ZAMANINDA doğrulamak için — apps/api,
// diag-service'in yanıtına GÜVENMEDEN önce bunlarla `.parse()` eder (bkz.
// ADR 0009, docs/adr/0009-workorder-diagnostic-report.md). Elle yazılmıştır;
// diag-service'in sözleşmesi değişirse (bkz.
// apps/diag-service/tests/test_openapi_contract.py) hem
// `generate:diag-types` hem bu dosya yeniden gözden geçirilmeli.

export const dtcMatchSchema = z.object({
  code: z.string(),
  description: z.string().nullable(),
  known: z.boolean(),
});

export const dtcParseResponseSchema = z.object({
  matches: z.array(dtcMatchSchema),
  unknown_codes: z.array(z.string()),
});

export const findingSchema = z.object({
  rule_id: z.string(),
  severity: z.string(),
  message: z.string(),
  row_index: z.number(),
  details: z.record(z.string(), z.number()),
});

export const wotAnalysisResponseSchema = z.object({
  row_count: z.number(),
  findings: z.array(findingSchema),
});
