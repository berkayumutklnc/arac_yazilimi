import type { VatRate } from "../../generated/prisma/enums.js";
import type { WorkOrderItemRecord } from "../workorder/workOrderItem.service.js";
import type { InvoiceStatus } from "./invoiceStatus.machine.js";

export interface InvoiceRecord {
  id: string;
  workOrderId: string;
  status: InvoiceStatus;
  invoiceNumber: string | null;
  issuedAt: Date | null;
  voidedAt: Date | null;
  totalKurus: number;
  createdAt: Date;
}

interface CreateDraftInvoiceLineInput {
  description: string;
  quantity: number;
  unitPriceKurus: number;
  vatRate: VatRate;
  netAmountKurus: number;
  vatAmountKurus: number;
  lineTotalKurus: number;
}

// tenantId bilinçli olarak yok — bkz. ADR 0006. Bu servis, iş emrinin varlığı/
// tenant'ı zaten doğrulanmış olarak (transitionWorkOrderStatus'un hemen
// ardından, aynı $transaction içinde — bkz. invoiceTransactional.ts) çağrılır;
// burada tekrar bir workOrder.findUnique yapılmaz.
export interface InvoiceGenerationDb {
  workOrderItem: {
    findMany: (args: { where: { workOrderId: string } }) => Promise<WorkOrderItemRecord[]>;
  };
  invoice: {
    create: (args: {
      data: {
        workOrderId: string;
        status: "DRAFT";
        invoiceNumber: null;
        totalKurus: number;
        lines: { create: CreateDraftInvoiceLineInput[] };
      };
    }) => Promise<InvoiceRecord>;
  };
}

// bkz. ADR 0014: WorkOrderItem'lar oluşturma anındaki hâlleriyle InvoiceLine'a
// KOPYALANIR (anlık görüntü) — sonradan kalem fiyatı/KDV'si değişse de fatura
// sabit kalır. Sıfır kalemli iş emri de geçerli — ₺0 taslak fatura oluşur,
// teslimatı engellemez. invoiceNumber yalnızca ISSUE anında atanır (bkz.
// invoiceNumber.ts).
export async function createDraftInvoiceForWorkOrder(
  db: InvoiceGenerationDb,
  workOrderId: string,
): Promise<InvoiceRecord> {
  const items = await db.workOrderItem.findMany({ where: { workOrderId } });

  const lines: CreateDraftInvoiceLineInput[] = items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unitPriceKurus: item.unitPriceKurus,
    vatRate: item.vatRate,
    netAmountKurus: item.netAmountKurus,
    vatAmountKurus: item.vatAmountKurus,
    lineTotalKurus: item.lineTotalKurus,
  }));

  const totalKurus = lines.reduce((sum, line) => sum + line.lineTotalKurus, 0);

  return db.invoice.create({
    data: {
      workOrderId,
      status: "DRAFT",
      invoiceNumber: null,
      totalKurus,
      lines: { create: lines },
    },
  });
}
