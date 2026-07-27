/**
 * Kötü niyetli komşu tenant testleri (bkz. docs/security-audit.md).
 *
 * Senaryo şablonu: Tenant A'nın verisi vardır. Tenant B'de (veya B'nin bir
 * bayisinde) kötü niyetli/hatalı bir istemci, A'nın kaynağının id'sini tahmin
 * eder veya ele geçirir ve kendi tenant bağlamıyla erişmeye/değiştirmeye
 * çalışır. Her test, izolasyonun kırılmadığını (ya doğrudan reddedilir ya da
 * "bulunamadı" görünür — asla başarıyla işlenmez) kanıtlar.
 *
 * Bu dosya, ilgili modüllerin kendi birim test dosyalarındaki testlerin
 * yerine değil, ek olarak; denetim raporunda referans verilen tek bir
 * konsolide güvenlik regresyon paketi olarak var.
 */
import { describe, expect, it, vi } from "vitest";
import { Role } from "../generated/prisma/enums.js";

import {
  transitionWorkOrderStatus,
  WorkOrderNotFoundError,
  type WorkOrderTransitionDb,
} from "../modules/workorder/workOrderTransition.service.js";
import {
  downloadEcuFile,
  EcuFileNotFoundError,
  type EcuFileDownloadDb,
  type EcuFileDownloadStoragePort,
} from "../modules/ecufile/ecuFileDownload.service.js";
import {
  transitionFileRequestStatus,
  ForbiddenRoleError as FileRequestForbiddenRoleError,
  type FileRequestDb,
} from "../modules/dealer/fileRequest.service.js";
import {
  fulfillFileRequest,
  type FulfillFileRequestDb,
} from "../modules/dealer/fileRequestFulfillment.service.js";

const TENANT_B = "tenant-B-attacker";

describe("Kötü niyetli komşu tenant — mevcut korumalar", () => {
  it("WorkOrder: Tenant B, Tenant A'nın iş emrinin id'sini tahmin edip durumunu değiştiremez", async () => {
    // Gerçek Prisma: findUnique({where:{id, tenantId}}) A'nın kaydını B'nin
    // tenantId'siyle asla döndürmez — mock burada bu tenant-scoped sorgunun
    // sonucunu simüle ediyor.
    const findUnique = vi.fn<WorkOrderTransitionDb["workOrder"]["findUnique"]>();
    findUnique.mockResolvedValue(null); // B'nin tenantId'siyle A'nın kaydı bulunamaz
    const update = vi.fn<WorkOrderTransitionDb["workOrder"]["update"]>();
    const auditCreate = vi.fn<WorkOrderTransitionDb["workOrderStatusAuditLog"]["create"]>();
    const db: WorkOrderTransitionDb = {
      workOrder: { findUnique, update },
      workOrderStatusAuditLog: { create: auditCreate },
    };

    await expect(
      transitionWorkOrderStatus(db, {
        workOrderId: "wo-belongs-to-A",
        tenantId: TENANT_B,
        toStatus: "ACCEPTED",
        changedBy: "attacker-user",
      }),
    ).rejects.toBeInstanceOf(WorkOrderNotFoundError);
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: "wo-belongs-to-A", tenantId: TENANT_B },
    });
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("EcuFile indirme: Tenant B, Tenant A'nın ECU dosyasını indiremez", async () => {
    const findUnique = vi.fn<EcuFileDownloadDb["ecuFile"]["findUnique"]>();
    findUnique.mockResolvedValue(null);
    const auditCreate = vi.fn<EcuFileDownloadDb["ecuFileDownloadAuditLog"]["create"]>();
    const createPresignedDownloadUrl =
      vi.fn<EcuFileDownloadStoragePort["createPresignedDownloadUrl"]>();
    const db: EcuFileDownloadDb = {
      ecuFile: { findUnique },
      ecuFileDownloadAuditLog: { create: auditCreate },
    };

    await expect(
      downloadEcuFile(
        { db, storage: { createPresignedDownloadUrl } },
        {
          tenantId: TENANT_B,
          ecuFileId: "file-belongs-to-A",
          requestedBy: { id: "attacker-user", role: Role.OWNER },
        },
      ),
    ).rejects.toBeInstanceOf(EcuFileNotFoundError);
    expect(createPresignedDownloadUrl).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("FileRequest işleme: Tenant C'nin OWNER'ı, Tenant A→Tenant hub B talebini işleyemez", async () => {
    const findUnique = vi.fn<FileRequestDb["fileRequest"]["findUnique"]>();
    const update = vi.fn<FileRequestDb["fileRequest"]["update"]>();
    const auditCreate = vi.fn<FileRequestDb["fileRequestStatusAuditLog"]["create"]>();
    const dealerAccountFindFirst = vi.fn<FileRequestDb["dealerAccount"]["findFirst"]>();
    const db: FileRequestDb = {
      dealerAccount: { findFirst: dealerAccountFindFirst },
      fileRequest: { create: vi.fn(), findUnique, update },
      fileRequestStatusAuditLog: { create: auditCreate },
    };
    const intruderFromTenantC = { id: "intruder", tenantId: "tenant-C", role: Role.OWNER };

    await expect(
      transitionFileRequestStatus(db, {
        fileRequestId: "req-hub-B",
        hubTenantId: TENANT_B,
        toStatus: "ACCEPTED",
        actingUser: intruderFromTenantC,
        costKurus: 1000,
      }),
    ).rejects.toBeInstanceOf(FileRequestForbiddenRoleError);
    expect(findUnique).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it("FileRequest fulfill: yanlış hub tenant'ının OWNER'ı kalibre dosya yükleyip kredi düşüremez", async () => {
    const ecuFileCreate = vi.fn<FulfillFileRequestDb["ecuFile"]["create"]>();
    const ecuFileFindUnique = vi.fn<FulfillFileRequestDb["ecuFile"]["findUnique"]>();
    const fileRequestFindUnique = vi.fn<FulfillFileRequestDb["fileRequest"]["findUnique"]>();
    const fileRequestUpdate = vi.fn<FulfillFileRequestDb["fileRequest"]["update"]>();
    const dealerAccountFindUnique = vi.fn<FulfillFileRequestDb["dealerAccount"]["findUnique"]>();
    const dealerAccountUpdate = vi.fn<FulfillFileRequestDb["dealerAccount"]["update"]>();
    const dealerCreditTransactionCreate =
      vi.fn<FulfillFileRequestDb["dealerCreditTransaction"]["create"]>();
    const auditCreate = vi.fn<FulfillFileRequestDb["fileRequestStatusAuditLog"]["create"]>();
    const db: FulfillFileRequestDb = {
      ecuFile: { create: ecuFileCreate, findUnique: ecuFileFindUnique },
      fileRequest: { findUnique: fileRequestFindUnique, update: fileRequestUpdate },
      dealerAccount: { findUnique: dealerAccountFindUnique, update: dealerAccountUpdate },
      dealerCreditTransaction: { create: dealerCreditTransactionCreate },
      fileRequestStatusAuditLog: { create: auditCreate },
    };
    const intruderOwner = { id: "intruder-owner", tenantId: "tenant-not-the-hub", role: Role.OWNER };

    await expect(
      fulfillFileRequest(db, {
        fileRequestId: "req-1",
        hubTenantId: TENANT_B,
        actingUser: intruderOwner,
        storageKey: "s3://stolen/file.bin",
        checksum: "irrelevant",
      }),
    ).rejects.toThrow();
    expect(fileRequestFindUnique).not.toHaveBeenCalled();
    expect(ecuFileCreate).not.toHaveBeenCalled();
    expect(dealerAccountUpdate).not.toHaveBeenCalled();
    expect(dealerCreditTransactionCreate).not.toHaveBeenCalled();
  });
});
