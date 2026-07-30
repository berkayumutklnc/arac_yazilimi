import { describe, expect, it, vi } from "vitest";
import {
  changeUserRoleTransactional,
  deactivateUserTransactional,
} from "./userManagementTransactional.js";
import { CannotRemoveLastOwnerError } from "./userManagement.service.js";
import { Role } from "../../generated/prisma/enums.js";
import type { PrismaClient } from "../../generated/prisma/client.js";

const tenantId = "tenant-1";
const owner = { id: "owner-1", tenantId, role: Role.OWNER };

function createFakeTx(overrides: { targetRow?: Record<string, unknown> | null; ownerCount?: number } = {}) {
  const userFindUnique = vi.fn().mockResolvedValue(
    overrides.targetRow === undefined
      ? { id: "user-2", tenantId, role: Role.ENGINEER, deactivatedAt: null }
      : overrides.targetRow,
  );
  const userUpdate = vi.fn().mockResolvedValue({});
  const userCount = vi.fn().mockResolvedValue(overrides.ownerCount ?? 2);
  const auditCreate = vi.fn().mockResolvedValue({});
  const refreshTokenUpdateMany = vi.fn().mockResolvedValue({});

  const tx = {
    user: { findUnique: userFindUnique, update: userUpdate, count: userCount },
    userManagementAuditLog: { create: auditCreate },
    refreshToken: { updateMany: refreshTokenUpdateMany },
  };

  return { tx, userFindUnique, userUpdate, userCount, auditCreate, refreshTokenUpdateMany };
}

function createFakePrisma(tx: unknown) {
  const $transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(tx));
  const prisma = { $transaction } as unknown as PrismaClient;
  return { prisma, $transaction };
}

describe("changeUserRoleTransactional", () => {
  it("prisma.$transaction içinde çalışır ve rolü günceller", async () => {
    const { tx, userUpdate } = createFakeTx();
    const { prisma, $transaction } = createFakePrisma(tx);

    await changeUserRoleTransactional(prisma, tenantId, owner, "user-2", Role.RECEPTIONIST);

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-2", tenantId },
      data: { role: Role.RECEPTIONIST },
    });
  });

  it("son OWNER korumasını (saf servisten miras) korur", async () => {
    const { tx } = createFakeTx({
      targetRow: { id: "user-2", tenantId, role: Role.OWNER, deactivatedAt: null },
      ownerCount: 1,
    });
    const { prisma } = createFakePrisma(tx);

    await expect(
      changeUserRoleTransactional(prisma, tenantId, owner, "user-2", Role.ENGINEER),
    ).rejects.toBeInstanceOf(CannotRemoveLastOwnerError);
  });
});

describe("deactivateUserTransactional", () => {
  it("prisma.$transaction içinde çalışır, deactivatedAt set eder ve refresh token'ları iptal eder", async () => {
    const { tx, userUpdate, refreshTokenUpdateMany } = createFakeTx();
    const { prisma, $transaction } = createFakePrisma(tx);

    await deactivateUserTransactional(prisma, tenantId, owner, "user-2");

    expect($transaction).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith({
      where: { id: "user-2", tenantId },
      data: { deactivatedAt: expect.any(Date) as Date },
    });
    expect(refreshTokenUpdateMany).toHaveBeenCalledWith({
      where: { userId: "user-2", revokedAt: null },
      data: { revokedAt: expect.any(Date) as Date },
    });
  });
});
