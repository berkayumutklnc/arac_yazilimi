import { describe, expect, it, vi } from "vitest";
import { allocateInvoiceNumber, formatInvoiceNumber } from "./invoiceNumber.js";
import type { Prisma } from "../../generated/prisma/client.js";

describe("formatInvoiceNumber", () => {
  it.each([
    [2026, 1, "2026-000001"],
    [2026, 42, "2026-000042"],
    [2026, 999999, "2026-999999"],
    [2027, 6, "2027-000006"],
  ])("formatInvoiceNumber(%s, %s) === %s", (year, seq, expected) => {
    expect(formatInvoiceNumber(year, seq)).toBe(expected);
  });
});

const tenantId = "tenant-1";
const year = 2026;

function createFakeTx(lastNumber: number | undefined) {
  const queryRaw = vi.fn().mockResolvedValue(lastNumber === undefined ? [] : [{ lastNumber }]);
  const executeRaw = vi.fn().mockResolvedValue(1);
  const tx = { $queryRaw: queryRaw, $executeRaw: executeRaw } as unknown as Prisma.TransactionClient;
  return { tx, queryRaw, executeRaw };
}

describe("allocateInvoiceNumber", () => {
  it("sayaç satırını INSERT..ON CONFLICT DO NOTHING ile garanti eder", async () => {
    const { tx, executeRaw } = createFakeTx(0);

    await allocateInvoiceNumber(tx, tenantId, year);

    const [strings, ...values] = executeRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain("ON CONFLICT");
    expect(values).toContain(tenantId);
    expect(values).toContain(year);
  });

  it("satırı FOR UPDATE ile kilitler", async () => {
    const { tx, queryRaw } = createFakeTx(0);

    await allocateInvoiceNumber(tx, tenantId, year);

    const [strings, ...values] = queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
    expect(strings.join("?")).toContain("FOR UPDATE");
    expect(values).toContain(tenantId);
    expect(values).toContain(year);
  });

  it("satır ilk kez oluşturulduysa (lastNumber=0) 1 döner ve sayaç 1'e güncellenir", async () => {
    const { tx, executeRaw } = createFakeTx(0);

    const result = await allocateInvoiceNumber(tx, tenantId, year);

    expect(result).toBe(1);
    const [, ...updateValues] = executeRaw.mock.calls[1] as [TemplateStringsArray, ...unknown[]];
    expect(updateValues).toContain(1);
  });

  it("mevcut sayaç lastNumber=41 ise 42 döner", async () => {
    const { tx, executeRaw } = createFakeTx(41);

    const result = await allocateInvoiceNumber(tx, tenantId, year);

    expect(result).toBe(42);
    const [, ...updateValues] = executeRaw.mock.calls[1] as [TemplateStringsArray, ...unknown[]];
    expect(updateValues).toContain(42);
  });
});
