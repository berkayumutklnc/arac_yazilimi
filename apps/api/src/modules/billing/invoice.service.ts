import type { VatRate } from "../../generated/prisma/enums.js";
import { assertValidTransition, requiresReason, type InvoiceStatus } from "./invoiceStatus.machine.js";
import type { InvoiceRecord } from "./invoiceGeneration.service.js";

export class InvoiceNotFoundError extends Error {
  constructor(id: string) {
    super(`Fatura bulunamadı: ${id}`);
    this.name = "InvoiceNotFoundError";
  }
}

export class MissingInvoiceTransitionReasonError extends Error {
  constructor(
    public readonly from: InvoiceStatus,
    public readonly to: InvoiceStatus,
  ) {
    super(`${from} -> ${to} geçişi için "reason" zorunludur.`);
    this.name = "MissingInvoiceTransitionReasonError";
  }
}

export interface InvoiceLineRecord {
  id: string;
  description: string;
  quantity: number;
  unitPriceKurus: number;
  vatRate: VatRate;
  netAmountKurus: number;
  vatAmountKurus: number;
  lineTotalKurus: number;
}

export interface InvoiceWithLines extends InvoiceRecord {
  lines: InvoiceLineRecord[];
}

// tenantId bilinçli olarak yok — db, request başına tenant-scoped oluşturulur
// (bkz. db/tenantScopedDb.ts, ADR 0006).
export interface InvoiceDb {
  invoice: {
    findUnique: (args: { where: { id: string } | { workOrderId: string } }) => Promise<InvoiceRecord | null>;
    update: (args: {
      where: { id: string };
      data: {
        status: InvoiceStatus;
        invoiceNumber?: string;
        issuedAt?: Date;
        voidedAt?: Date;
      };
    }) => Promise<unknown>;
  };
  // InvoiceLine'ın tenantId kolonu yok — invoiceId zaten scoped invoice.findUnique
  // ile doğrulandı (bkz. workOrderItem.service.ts'teki aynı gerekçe).
  invoiceLine: {
    findMany: (args: { where: { invoiceId: string } }) => Promise<InvoiceLineRecord[]>;
  };
  invoiceStatusAuditLog: {
    create: (args: {
      data: {
        invoiceId: string;
        fromStatus: InvoiceStatus;
        toStatus: InvoiceStatus;
        reason: string | null;
        changedBy: string;
      };
    }) => Promise<unknown>;
  };
  payment: {
    create: (args: { data: { invoiceId: string; amountKurus: number } }) => Promise<unknown>;
  };
}

// bkz. ADR 0014 — kalemler yalnızca DELIVERED anında donduğundan satırlar
// hiç değişmez; issue/pay/void aksiyonlarının yanıtı bu yüzden satırları
// TAŞIMAZ, yalnızca bu görüntüleme endpoint'i taşır (frontend aksiyon
// sonrası bu endpoint'i tekrar çağırır).
export async function getInvoiceForWorkOrder(db: InvoiceDb, workOrderId: string): Promise<InvoiceWithLines> {
  const invoice = await db.invoice.findUnique({ where: { workOrderId } });
  if (!invoice) {
    throw new InvoiceNotFoundError(workOrderId);
  }
  const lines = await db.invoiceLine.findMany({ where: { invoiceId: invoice.id } });
  return { ...invoice, lines };
}

export interface IssueInvoiceParams {
  invoiceId: string;
  // Çağıranın (invoiceTransactional.ts) allocateInvoiceNumber + formatInvoiceNumber
  // ile ÖNCEDEN hesapladığı numara — bu fonksiyon saf kalsın diye burada
  // raw SQL/sayaç mantığı yok (bkz. ADR 0014, invoiceNumber.ts).
  invoiceNumber: string;
  actorId: string;
}

export async function issueInvoice(db: InvoiceDb, params: IssueInvoiceParams): Promise<InvoiceRecord> {
  const invoice = await db.invoice.findUnique({ where: { id: params.invoiceId } });
  if (!invoice) {
    throw new InvoiceNotFoundError(params.invoiceId);
  }

  assertValidTransition(invoice.status, "ISSUED");

  const issuedAt = new Date();
  await db.invoice.update({
    where: { id: invoice.id },
    data: { status: "ISSUED", invoiceNumber: params.invoiceNumber, issuedAt },
  });
  await db.invoiceStatusAuditLog.create({
    data: {
      invoiceId: invoice.id,
      fromStatus: invoice.status,
      toStatus: "ISSUED",
      reason: null,
      changedBy: params.actorId,
    },
  });

  return { ...invoice, status: "ISSUED", invoiceNumber: params.invoiceNumber, issuedAt };
}

export interface MarkInvoicePaidParams {
  invoiceId: string;
  actorId: string;
}

export async function markInvoicePaid(db: InvoiceDb, params: MarkInvoicePaidParams): Promise<InvoiceRecord> {
  const invoice = await db.invoice.findUnique({ where: { id: params.invoiceId } });
  if (!invoice) {
    throw new InvoiceNotFoundError(params.invoiceId);
  }

  assertValidTransition(invoice.status, "PAID");

  await db.invoice.update({ where: { id: invoice.id }, data: { status: "PAID" } });
  // bkz. ADR 0014 kısıt — kısmi ödeme kapsam dışı: totalKurus tutarında TEK bir Payment satırı.
  await db.payment.create({ data: { invoiceId: invoice.id, amountKurus: invoice.totalKurus } });
  await db.invoiceStatusAuditLog.create({
    data: {
      invoiceId: invoice.id,
      fromStatus: invoice.status,
      toStatus: "PAID",
      reason: null,
      changedBy: params.actorId,
    },
  });

  return { ...invoice, status: "PAID" };
}

export interface VoidInvoiceParams {
  invoiceId: string;
  actorId: string;
  reason?: string;
}

export async function voidInvoice(db: InvoiceDb, params: VoidInvoiceParams): Promise<InvoiceRecord> {
  const invoice = await db.invoice.findUnique({ where: { id: params.invoiceId } });
  if (!invoice) {
    throw new InvoiceNotFoundError(params.invoiceId);
  }

  assertValidTransition(invoice.status, "VOID");

  if (requiresReason(invoice.status, "VOID") && !params.reason) {
    throw new MissingInvoiceTransitionReasonError(invoice.status, "VOID");
  }

  const voidedAt = new Date();
  await db.invoice.update({ where: { id: invoice.id }, data: { status: "VOID", voidedAt } });
  await db.invoiceStatusAuditLog.create({
    data: {
      invoiceId: invoice.id,
      fromStatus: invoice.status,
      toStatus: "VOID",
      reason: params.reason ?? null,
      changedBy: params.actorId,
    },
  });

  return { ...invoice, status: "VOID", voidedAt };
}
