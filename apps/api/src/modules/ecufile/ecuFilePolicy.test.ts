import { describe, expect, it } from "vitest";
import { detectIllegalContent } from "./ecuFilePolicy.js";

describe("detectIllegalContent", () => {
  it.each([
    ["dpf_off_stage1.bin", "dpf_off"],
    ["egr-delete-v2.bin", "egr_delete"],
    ["adblue off tool.bin", "adblue_off"],
    ["ADBLUE_DELETE_FINAL.bin", "adblue_off"],
    ["katalizör iptal.bin", "catalyst_delete"],
    ["catalyst-remove.bin", "catalyst_delete"],
    ["immobilizer bypass kit.bin", "immobilizer_bypass"],
    ["immo_atlatma_v1.bin", "immobilizer_bypass"],
  ])("'%s' dosya adında yasaklı kalıp tespit edilir (%s)", (fileName, expectedId) => {
    const result = detectIllegalContent(fileName);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(expectedId);
  });

  it.each([
    "stage1_remap_v3.bin",
    "original_stock_backup.bin",
    "dpf_regeneration_log.bin",
    "customer_invoice_march.pdf",
  ])("'%s' gibi meşru dosya adlarında yasaklı kalıp tespit edilmez", (fileName) => {
    expect(detectIllegalContent(fileName)).toBeNull();
  });

  it("dosya adı temizken metadata/açıklama alanında yasaklı kalıp tespit edilir", () => {
    const result = detectIllegalContent("stage1_final.bin egr delete request from customer");
    expect(result).not.toBeNull();
    expect(result?.id).toBe("egr_delete");
  });
});
