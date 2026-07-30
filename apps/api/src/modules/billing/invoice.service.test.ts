import { describe, expect, it, vi } from "vitest";
import {
  getInvoiceForWorkOrder,
  issueInvoice,
  markInvoicePaid,
  voidInvoice,
  InvoiceNotFoundError,
  MissingInvoiceTransitionReasonError,
  type InvoiceDb,
} from "./invoice.service.js";
import { InvalidInvoiceTransitionError } from "./invoiceStatus.machine.js";
import type { InvoiceRecord } from "./invoiceGeneration.service.js";

const invoiceId = "inv-1";
const workOrderId = "wo-1";
const actorId = "user-1";

function createMockDb() {
  const findUnique = vi.fn<InvoiceDb["invoice"]["findUnique"]>();
  const update = vi.fn<InvoiceDb["invoice"]["update"]>();
  const lineFindMany = vi.fn<InvoiceDb["invoiceLine"]["findMany"]>();
  lineFindMany.mockResolvedValue([]);
  const auditCreate = vi.fn<InvoiceDb["invoiceStatusAuditLog"]["create"]>();
  const paymentCreate = vi.fn<InvoiceDb["payment"]["create"]>();
  const db: InvoiceDb = {
    invoice: { findUnique, update },
    invoiceLine: { findMany: lineFindMany },
    invoiceStatusAuditLog: { create: auditCreate },
    payment: { create: paymentCreate },
  };
  return { db, findUnique, update, lineFindMany, auditCreate, paymentCreate };
}

function invoiceRow(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: invoiceId,
    workOrderId,
    status: "DRAFT",
    invoiceNumber: null,
    issuedAt: null,
    voidedAt: null,
    totalKurus: 12_000,
    createdAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("getInvoiceForWorkOrder", () => {
  it("fatura yoksa InvoiceNotFoundError fırlatır", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(getInvoiceForWorkOrder(db, workOrderId)).rejects.toBeInstanceOf(InvoiceNotFoundError);
  });

  it("faturayı workOrderId ile bulur", async () => {
    const { db, findUnique } = createMockDb();
    findUnique.mockResolvedValue(invoiceRow());

    const result = await getInvoiceForWorkOrder(db, workOrderId);

    expect(findUnique).toHaveBeenCalledWith({ where: { workOrderId } });
    expect(result.id).toBe(invoiceId);
  });

  it("satırları invoiceId ile getirip fatura ile birleştirir", async () => {
    const { db, findUnique, lineFindMany } = createMockDb();
    findUnique.mockResolvedValue(invoiceRow());
    lineFindMany.mockResolvedValue([
      {
        id: "line-1",
        description: "Stage 1 optimizasyon",
        quantity: 1,
        unitPriceKurus: 5_000_00,
        vatRate: "RATE_20",
        netAmountKurus: 5_000_00,
        vatAmountKurus: 1_000_00,
        lineTotalKurus: 6_000_00,
      },
    ]);

    const result = await getInvoiceForWorkOrder(db, workOrderId);

    expect(lineFindMany).toHaveBeenCalledWith({ where: { invoiceId } });
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]?.description).toBe("Stage 1 optimizasyon");
  });
});

describe("issueInvoice", () => {
  it("fatura bulunamazsa InvoiceNotFoundError fırlatır", async () => {
    const { db, findUnique, update } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(
      issueInvoice(db, { invoiceId, invoiceNumber: "2026-000001", actorId }),
    ).rejects.toBeInstanceOf(InvoiceNotFoundError);
    expect(update).not.toHaveBeenCalled();
  });

  it("DRAFT değilse InvalidInvoiceTransitionError fırlatır", async () => {
    const { db, findUnique, update } = createMockDb();
    findUnique.mockResolvedValue(invoiceRow({ status: "ISSUED" }));

    await expect(
      issueInvoice(db, { invoiceId, invoiceNumber: "2026-000001", actorId }),
    ).rejects.toBeInstanceOf(InvalidInvoiceTransitionError);
    expect(update).not.toHaveBeenCalled();
  });

  it("DRAFT ise ISSUED'a geçer, verilen invoiceNumber + issuedAt yazılır, audit log oluşur", async () => {
    const { db, findUnique, update, auditCreate } = createMockDb();
    findUnique.mockResolvedValue(invoiceRow());

    const result = await issueInvoice(db, { invoiceId, invoiceNumber: "2026-000001", actorId });

    expect(update).toHaveBeenCalledWith({
      where: { id: invoiceId },
      data: { status: "ISSUED", invoiceNumber: "2026-000001", issuedAt: expect.any(Date) as Date },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: { invoiceId, fromStatus: "DRAFT", toStatus: "ISSUED", reason: null, changedBy: actorId },
    });
    expect(result.status).toBe("ISSUED");
    expect(result.invoiceNumber).toBe("2026-000001");
  });
});

describe("markInvoicePaid", () => {
  it("fatura bulunamazsa InvoiceNotFoundError fırlatır", async () => {
    const { db, findUnique, paymentCreate } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(markInvoicePaid(db, { invoiceId, actorId })).rejects.toBeInstanceOf(InvoiceNotFoundError);
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("ISSUED değilse InvalidInvoiceTransitionError fırlatır", async () => {
    const { db, findUnique, paymentCreate } = createMockDb();
    findUnique.mockResolvedValue(invoiceRow({ status: "DRAFT" }));

    await expect(markInvoicePaid(db, { invoiceId, actorId })).rejects.toBeInstanceOf(
      InvalidInvoiceTransitionError,
    );
    expect(paymentCreate).not.toHaveBeenCalled();
  });

  it("ISSUED ise PAID'e geçer, totalKurus tutarında tek Payment oluşturur", async () => {
    const { db, findUnique, update, paymentCreate, auditCreate } = createMockDb();
    findUnique.mockResolvedValue(invoiceRow({ status: "ISSUED", invoiceNumber: "2026-000001", totalKurus: 45_00 }));

    const result = await markInvoicePaid(db, { invoiceId, actorId });

    expect(update).toHaveBeenCalledWith({ where: { id: invoiceId }, data: { status: "PAID" } });
    expect(paymentCreate).toHaveBeenCalledWith({ data: { invoiceId, amountKurus: 45_00 } });
    expect(auditCreate).toHaveBeenCalledWith({
      data: { invoiceId, fromStatus: "ISSUED", toStatus: "PAID", reason: null, changedBy: actorId },
    });
    expect(result.status).toBe("PAID");
  });
});

describe("voidInvoice", () => {
  it("fatura bulunamazsa InvoiceNotFoundError fırlatır", async () => {
    const { db, findUnique, update } = createMockDb();
    findUnique.mockResolvedValue(null);

    await expect(voidInvoice(db, { invoiceId, actorId, reason: "İptal" })).rejects.toBeInstanceOf(
      InvoiceNotFoundError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("ISSUED değilse (ör. DRAFT) InvalidInvoiceTransitionError fırlatır", async () => {
    const { db, findUnique, update } = createMockDb();
    findUnique.mockResolvedValue(invoiceRow({ status: "DRAFT" }));

    await expect(voidInvoice(db, { invoiceId, actorId, reason: "İptal" })).rejects.toBeInstanceOf(
      InvalidInvoiceTransitionError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("reason olmadan denenirse MissingInvoiceTransitionReasonError fırlatır", async () => {
    const { db, findUnique, update } = createMockDb();
    findUnique.mockResolvedValue(invoiceRow({ status: "ISSUED" }));

    await expect(voidInvoice(db, { invoiceId, actorId })).rejects.toBeInstanceOf(
      MissingInvoiceTransitionReasonError,
    );
    expect(update).not.toHaveBeenCalled();
  });

  it("ISSUED + reason ile VOID'e geçer, voidedAt + audit log reason'ı taşır", async () => {
    const { db, findUnique, update, auditCreate } = createMockDb();
    findUnique.mockResolvedValue(invoiceRow({ status: "ISSUED" }));

    const result = await voidInvoice(db, { invoiceId, actorId, reason: "Müşteri iptal etti" });

    expect(update).toHaveBeenCalledWith({
      where: { id: invoiceId },
      data: { status: "VOID", voidedAt: expect.any(Date) as Date },
    });
    expect(auditCreate).toHaveBeenCalledWith({
      data: { invoiceId, fromStatus: "ISSUED", toStatus: "VOID", reason: "Müşteri iptal etti", changedBy: actorId },
    });
    expect(result.status).toBe("VOID");
  });
});
