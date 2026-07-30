import { describe, expect, it, vi } from "vitest";
import { createDraftInvoiceForWorkOrder, type InvoiceGenerationDb } from "./invoiceGeneration.service.js";

const workOrderId = "wo-1";

function createMockDb() {
  const findMany = vi.fn<InvoiceGenerationDb["workOrderItem"]["findMany"]>();
  const create = vi.fn<InvoiceGenerationDb["invoice"]["create"]>();
  const db: InvoiceGenerationDb = {
    workOrderItem: { findMany },
    invoice: { create },
  };
  return { db, findMany, create };
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    workOrderId,
    itemType: "SERVICE" as const,
    description: "Yağ değişimi",
    serviceTypeId: null,
    quantity: 1,
    unitPriceKurus: 100_00,
    vatRate: "RATE_20" as const,
    netAmountKurus: 100_00,
    vatAmountKurus: 20_00,
    lineTotalKurus: 120_00,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("createDraftInvoiceForWorkOrder", () => {
  it("kalem yoksa ₺0 taslak fatura oluşturur", async () => {
    const { db, findMany, create } = createMockDb();
    findMany.mockResolvedValue([]);
    create.mockResolvedValue({
      id: "inv-1",
      workOrderId,
      status: "DRAFT",
      invoiceNumber: null,
      issuedAt: null,
      voidedAt: null,
      totalKurus: 0,
      createdAt: new Date("2026-01-01"),
    });

    await createDraftInvoiceForWorkOrder(db, workOrderId);

    expect(create).toHaveBeenCalledWith({
      data: {
        workOrderId,
        status: "DRAFT",
        invoiceNumber: null,
        totalKurus: 0,
        lines: { create: [] },
      },
    });
  });

  it("mevcut kalemleri InvoiceLine'a anlık görüntü olarak kopyalar, totalKurus satırların toplamıdır", async () => {
    const { db, findMany, create } = createMockDb();
    findMany.mockResolvedValue([
      item({ id: "item-1", description: "Yağ değişimi", lineTotalKurus: 120_00 }),
      item({
        id: "item-2",
        description: "Fren balatası",
        quantity: 2,
        unitPriceKurus: 250_00,
        vatRate: "RATE_20",
        netAmountKurus: 500_00,
        vatAmountKurus: 100_00,
        lineTotalKurus: 600_00,
      }),
    ]);
    create.mockResolvedValue({
      id: "inv-1",
      workOrderId,
      status: "DRAFT",
      invoiceNumber: null,
      issuedAt: null,
      voidedAt: null,
      totalKurus: 720_00,
      createdAt: new Date("2026-01-01"),
    });

    const result = await createDraftInvoiceForWorkOrder(db, workOrderId);

    expect(create).toHaveBeenCalledWith({
      data: {
        workOrderId,
        status: "DRAFT",
        invoiceNumber: null,
        totalKurus: 720_00,
        lines: {
          create: [
            {
              description: "Yağ değişimi",
              quantity: 1,
              unitPriceKurus: 100_00,
              vatRate: "RATE_20",
              netAmountKurus: 100_00,
              vatAmountKurus: 20_00,
              lineTotalKurus: 120_00,
            },
            {
              description: "Fren balatası",
              quantity: 2,
              unitPriceKurus: 250_00,
              vatRate: "RATE_20",
              netAmountKurus: 500_00,
              vatAmountKurus: 100_00,
              lineTotalKurus: 600_00,
            },
          ],
        },
      },
    });
    expect(result.id).toBe("inv-1");
  });
});
