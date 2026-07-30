import { describe, expect, it, vi } from "vitest";
import { deliverWorkOrderTransactional, issueInvoiceTransactional } from "./invoiceTransactional.js";
import { InvalidWorkOrderTransitionError } from "../workorder/workOrderStatus.machine.js";
import { InvoiceNotFoundError } from "./invoice.service.js";
import { InvalidInvoiceTransitionError } from "./invoiceStatus.machine.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

const tenantId = "tenant-1";
const workOrderId = "wo-1";
const invoiceId = "inv-1";
const actorId = "user-1";

function createFakePrisma(tx: unknown) {
  const $transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(tx));
  const prisma = { $transaction } as unknown as PrismaClient;
  return { prisma, $transaction };
}

describe("deliverWorkOrderTransactional", () => {
  function createFakeTx(overrides: { workOrderRow?: Record<string, unknown> | null } = {}) {
    const workOrderFindUnique = vi.fn().mockResolvedValue(
      overrides.workOrderRow === undefined ? { id: workOrderId, status: "QUALITY_CHECK" } : overrides.workOrderRow,
    );
    const workOrderUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const itemFindMany = vi.fn().mockResolvedValue([]);
    const invoiceCreate = vi.fn().mockResolvedValue({
      id: invoiceId,
      workOrderId,
      status: "DRAFT",
      invoiceNumber: null,
      issuedAt: null,
      voidedAt: null,
      totalKurus: 0,
      createdAt: new Date("2026-01-01"),
    });

    const tx = {
      workOrder: { findUnique: workOrderFindUnique, update: workOrderUpdate },
      workOrderStatusAuditLog: { create: auditCreate },
      workOrderItem: { findMany: itemFindMany },
      invoice: { create: invoiceCreate },
    };

    return { tx, workOrderFindUnique, workOrderUpdate, auditCreate, itemFindMany, invoiceCreate };
  }

  it("prisma.$transaction içinde tek bir işlem olarak çalışır", async () => {
    const { tx } = createFakeTx();
    const { prisma, $transaction } = createFakePrisma(tx);

    await deliverWorkOrderTransactional(prisma, tenantId, { workOrderId, toStatus: "DELIVERED", changedBy: actorId });

    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("workOrder sorgularına tenantId enjekte edilir", async () => {
    const { tx, workOrderFindUnique, workOrderUpdate } = createFakeTx();
    const { prisma } = createFakePrisma(tx);

    await deliverWorkOrderTransactional(prisma, tenantId, { workOrderId, toStatus: "DELIVERED", changedBy: actorId });

    expect(workOrderFindUnique).toHaveBeenCalledWith({ where: { id: workOrderId, tenantId } });
    expect(workOrderUpdate).toHaveBeenCalledWith({
      where: { id: workOrderId, tenantId },
      data: { status: "DELIVERED" },
    });
  });

  it("geçersiz geçişte (ör. DRAFT'tan doğrudan DELIVERED) InvalidWorkOrderTransitionError fırlatır, fatura oluşmaz", async () => {
    const { tx, invoiceCreate } = createFakeTx({ workOrderRow: { id: workOrderId, status: "DRAFT" } });
    const { prisma } = createFakePrisma(tx);

    await expect(
      deliverWorkOrderTransactional(prisma, tenantId, { workOrderId, toStatus: "DELIVERED", changedBy: actorId }),
    ).rejects.toBeInstanceOf(InvalidWorkOrderTransitionError);
    expect(invoiceCreate).not.toHaveBeenCalled();
  });

  it("başarılı geçişte kalemsiz taslak fatura (₺0) oluşturur ve döner", async () => {
    const { tx, invoiceCreate } = createFakeTx();
    const { prisma } = createFakePrisma(tx);

    const result = await deliverWorkOrderTransactional(prisma, tenantId, {
      workOrderId,
      toStatus: "DELIVERED",
      changedBy: actorId,
    });

    expect(invoiceCreate).toHaveBeenCalledWith({
      data: { workOrderId, status: "DRAFT", invoiceNumber: null, totalKurus: 0, lines: { create: [] }, tenantId },
    });
    expect(result.id).toBe(invoiceId);
  });
});

describe("issueInvoiceTransactional", () => {
  function createFakeTx(overrides: {
    invoiceRow?: Record<string, unknown> | null;
    counterQueryRow?: Record<string, unknown>[];
  } = {}) {
    const invoiceFindUnique = vi.fn().mockResolvedValue(
      overrides.invoiceRow === undefined
        ? { id: invoiceId, workOrderId, status: "DRAFT", invoiceNumber: null, issuedAt: null, voidedAt: null, totalKurus: 100_00, createdAt: new Date("2026-01-01") }
        : overrides.invoiceRow,
    );
    const invoiceUpdate = vi.fn().mockResolvedValue({});
    const auditCreate = vi.fn().mockResolvedValue({});
    const executeRaw = vi.fn().mockResolvedValue(1);
    const queryRaw = vi.fn().mockResolvedValue(overrides.counterQueryRow ?? [{ lastNumber: 0 }]);

    const tx = {
      invoice: { findUnique: invoiceFindUnique, update: invoiceUpdate },
      invoiceStatusAuditLog: { create: auditCreate },
      payment: { create: vi.fn().mockResolvedValue({}) },
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    };

    return { tx, invoiceFindUnique, invoiceUpdate, auditCreate, executeRaw, queryRaw };
  }

  it("prisma.$transaction içinde tek bir işlem olarak çalışır", async () => {
    const { tx } = createFakeTx();
    const { prisma, $transaction } = createFakePrisma(tx);

    await issueInvoiceTransactional(prisma, tenantId, invoiceId, actorId);

    expect($transaction).toHaveBeenCalledTimes(1);
  });

  it("fatura bulunamazsa InvoiceNotFoundError fırlatır (transaction geri alınır, sayaç artışı da geri döner)", async () => {
    const { tx, invoiceUpdate } = createFakeTx({ invoiceRow: null });
    const { prisma } = createFakePrisma(tx);

    await expect(issueInvoiceTransactional(prisma, tenantId, invoiceId, actorId)).rejects.toBeInstanceOf(
      InvoiceNotFoundError,
    );
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it("fatura DRAFT değilse InvalidInvoiceTransitionError fırlatır, fatura güncellenmez", async () => {
    const { tx, invoiceUpdate } = createFakeTx({
      invoiceRow: { id: invoiceId, workOrderId, status: "ISSUED", invoiceNumber: "2026-000001", issuedAt: new Date(), voidedAt: null, totalKurus: 100_00, createdAt: new Date() },
    });
    const { prisma } = createFakePrisma(tx);

    await expect(issueInvoiceTransactional(prisma, tenantId, invoiceId, actorId)).rejects.toBeInstanceOf(
      InvalidInvoiceTransitionError,
    );
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it("sıradaki numarayı FOR UPDATE ile kilitli sayaçtan alır ve fatura numarasını atar", async () => {
    const { tx, invoiceUpdate } = createFakeTx({ counterQueryRow: [{ lastNumber: 41 }] });
    const { prisma } = createFakePrisma(tx);
    const year = new Date().getFullYear();

    const result = await issueInvoiceTransactional(prisma, tenantId, invoiceId, actorId);

    const expectedNumber = `${year}-000042`;
    expect(result.invoiceNumber).toBe(expectedNumber);
    expect(invoiceUpdate).toHaveBeenCalledWith({
      where: { id: invoiceId, tenantId },
      data: { status: "ISSUED", invoiceNumber: expectedNumber, issuedAt: expect.any(Date) as Date },
    });
  });

  it("invoice sorgularına tenantId enjekte edilir", async () => {
    const { tx, invoiceFindUnique } = createFakeTx();
    const { prisma } = createFakePrisma(tx);

    await issueInvoiceTransactional(prisma, tenantId, invoiceId, actorId);

    expect(invoiceFindUnique).toHaveBeenCalledWith({ where: { id: invoiceId, tenantId } });
  });
});
