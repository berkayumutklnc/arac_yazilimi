import type { PrismaClient, Prisma } from "../../generated/prisma/client.js";
import { applyTenantScope } from "../../db/tenantScopedDb.js";
import {
  transitionWorkOrderStatus,
  type WorkOrderTransitionDb,
  type TransitionWorkOrderStatusParams,
} from "../workorder/workOrderTransition.service.js";
import { createDraftInvoiceForWorkOrder, type InvoiceGenerationDb, type InvoiceRecord } from "./invoiceGeneration.service.js";
import { issueInvoice, type InvoiceDb } from "./invoice.service.js";
import { allocateInvoiceNumber, formatInvoiceNumber } from "./invoiceNumber.js";

// bkz. ADR 0014, dealer/fileRequestFulfillmentTransactional.ts'deki AYNI desen:
// pure servislerin (transitionWorkOrderStatus, createDraftInvoiceForWorkOrder,
// issueInvoice) DEĞİŞTİRMEDEN, tek bir prisma.$transaction üzerinde çalışan
// ÜRETİM adaptörlerini sağlar. Tenant kapsamlaması burada applyTenantScope ile
// elle uygulanır — bu atomik işlem TAMAMEN aynı transaction (`tx`) içinde
// kalsın diye (bkz. fileRequestFulfillmentTransactional.ts'deki aynı gerekçe).

function buildWorkOrderTransitionDb(tx: Prisma.TransactionClient, tenantId: string): WorkOrderTransitionDb {
  return {
    workOrder: {
      findUnique: (args) =>
        tx.workOrder.findUnique(
          applyTenantScope("WorkOrder", "findUnique", args, tenantId) as Prisma.WorkOrderFindUniqueArgs,
        ),
      update: (args) =>
        tx.workOrder.update(
          applyTenantScope("WorkOrder", "update", args, tenantId) as Prisma.WorkOrderUpdateArgs,
        ),
    },
    workOrderStatusAuditLog: {
      create: (args) =>
        tx.workOrderStatusAuditLog.create(
          applyTenantScope(
            "WorkOrderStatusAuditLog",
            "create",
            args,
            tenantId,
          ) as Prisma.WorkOrderStatusAuditLogCreateArgs,
        ),
    },
  };
}

function buildInvoiceGenerationDb(tx: Prisma.TransactionClient, tenantId: string): InvoiceGenerationDb {
  return {
    // WorkOrderItem'ın tenantId kolonu yok — üst iş emrinin tenant'a ait
    // olduğu transitionWorkOrderStatus'un findUnique'i ile zaten doğrulandı
    // (bkz. workOrderItem.service.ts'teki aynı gerekçe).
    workOrderItem: {
      findMany: (args) => tx.workOrderItem.findMany(args),
    },
    invoice: {
      create: (args) =>
        tx.invoice.create(applyTenantScope("Invoice", "create", args, tenantId) as Prisma.InvoiceCreateArgs),
    },
  };
}

function buildInvoiceDb(tx: Prisma.TransactionClient, tenantId: string): InvoiceDb {
  return {
    invoice: {
      findUnique: (args) =>
        tx.invoice.findUnique(
          applyTenantScope("Invoice", "findUnique", args, tenantId) as Prisma.InvoiceFindUniqueArgs,
        ),
      update: (args) =>
        tx.invoice.update(applyTenantScope("Invoice", "update", args, tenantId) as Prisma.InvoiceUpdateArgs),
    },
    // InvoiceLine'ın tenantId kolonu yok — invoiceId zaten scoped invoice.findUnique
    // ile doğrulandı.
    invoiceLine: {
      findMany: (args) => tx.invoiceLine.findMany(args),
    },
    invoiceStatusAuditLog: {
      create: (args) =>
        tx.invoiceStatusAuditLog.create(
          applyTenantScope("InvoiceStatusAuditLog", "create", args, tenantId) as Prisma.InvoiceStatusAuditLogCreateArgs,
        ),
    },
    // Payment'ın tenantId kolonu yok — invoiceId zaten scoped invoice.findUnique
    // ile doğrulandı.
    payment: {
      create: (args) => tx.payment.create(args),
    },
  };
}

// Yalnızca QUALITY_CHECK -> DELIVERED geçişi için — diğer TÜM WorkOrder
// geçişleri mevcut, transactional-olmayan transitionWorkOrderStatus(request.tenantDb,...)
// yolunu kullanmaya devam eder (bkz. workOrder.routes.ts, blast-radius kararı).
export async function deliverWorkOrderTransactional(
  prisma: PrismaClient,
  tenantId: string,
  params: TransitionWorkOrderStatusParams,
): Promise<InvoiceRecord> {
  return prisma.$transaction(async (tx) => {
    const transitionDb = buildWorkOrderTransitionDb(tx, tenantId);
    await transitionWorkOrderStatus(transitionDb, params);

    const generationDb = buildInvoiceGenerationDb(tx, tenantId);
    return createDraftInvoiceForWorkOrder(generationDb, params.workOrderId);
  });
}

export async function issueInvoiceTransactional(
  prisma: PrismaClient,
  tenantId: string,
  invoiceId: string,
  actorId: string,
): Promise<InvoiceRecord> {
  return prisma.$transaction(async (tx) => {
    const invoiceDb = buildInvoiceDb(tx, tenantId);

    // issueInvoice fatura bulunamazsa/DRAFT değilse hata fırlatırsa tüm
    // transaction (sayaç artışı dahil) geri alınır — "burnt" bir numara kalmaz.
    const year = new Date().getFullYear();
    const seq = await allocateInvoiceNumber(tx, tenantId, year);
    const invoiceNumber = formatInvoiceNumber(year, seq);

    return issueInvoice(invoiceDb, { invoiceId, invoiceNumber, actorId });
  });
}
