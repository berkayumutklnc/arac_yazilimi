import { describe, expect, it, vi } from "vitest";
import {
  downloadEcuFile,
  ForbiddenRoleError,
  EcuFileNotFoundError,
  type EcuFileDownloadDb,
  type EcuFileDownloadStoragePort,
} from "./ecuFileDownload.service.js";
import { Role } from "../../generated/prisma/enums.js";

const tenantId = "tenant-1";
const ecuFileId = "file-1";

function createMockDeps() {
  const findUnique = vi.fn<EcuFileDownloadDb["ecuFile"]["findUnique"]>();
  const auditCreate = vi.fn<EcuFileDownloadDb["ecuFileDownloadAuditLog"]["create"]>();
  const createPresignedDownloadUrl =
    vi.fn<EcuFileDownloadStoragePort["createPresignedDownloadUrl"]>();
  const db: EcuFileDownloadDb = {
    ecuFile: { findUnique },
    ecuFileDownloadAuditLog: { create: auditCreate },
  };
  const storage: EcuFileDownloadStoragePort = { createPresignedDownloadUrl };
  return { db, storage, findUnique, auditCreate, createPresignedDownloadUrl };
}

describe("downloadEcuFile", () => {
  it.each([Role.RECEPTIONIST, Role.DEALER])(
    "%s rolü indirmeye erişemez, ForbiddenRoleError fırlatılır",
    async (role) => {
      const { db, storage, findUnique, auditCreate, createPresignedDownloadUrl } =
        createMockDeps();

      await expect(
        downloadEcuFile(
          { db, storage },
          { tenantId, ecuFileId, requestedBy: { id: "user-1", role } },
        ),
      ).rejects.toBeInstanceOf(ForbiddenRoleError);
      expect(findUnique).not.toHaveBeenCalled();
      expect(createPresignedDownloadUrl).not.toHaveBeenCalled();
      expect(auditCreate).not.toHaveBeenCalled();
    },
  );

  it("ENGINEER rolü için dosya bulunamazsa EcuFileNotFoundError fırlatılır, audit log yazılmaz", async () => {
    const { db, storage, findUnique, auditCreate } = createMockDeps();
    findUnique.mockResolvedValue(null);

    await expect(
      downloadEcuFile(
        { db, storage },
        { tenantId, ecuFileId, requestedBy: { id: "user-1", role: Role.ENGINEER } },
      ),
    ).rejects.toBeInstanceOf(EcuFileNotFoundError);
    expect(auditCreate).not.toHaveBeenCalled();
  });

  it.each([Role.OWNER, Role.ENGINEER])(
    "%s rolü geçerli dosyayı indirebilir ve audit log kaydı yazılır (kim/ne zaman/rol)",
    async (role) => {
      const { db, storage, findUnique, auditCreate, createPresignedDownloadUrl } =
        createMockDeps();
      findUnique.mockResolvedValue({ id: ecuFileId, tenantId, storageKey: "tenant-1/file.bin" });
      createPresignedDownloadUrl.mockResolvedValue({
        downloadUrl: "https://s3.example.com/download",
      });

      const result = await downloadEcuFile(
        { db, storage },
        { tenantId, ecuFileId, requestedBy: { id: "user-1", role } },
      );

      expect(result.downloadUrl).toBe("https://s3.example.com/download");
      expect(auditCreate).toHaveBeenCalledWith({
        data: {
          tenantId,
          ecuFileId,
          downloadedBy: "user-1",
          downloadedByRole: role,
        },
      });
    },
  );

  it("findUnique tenant izolasyonuyla çağrılır", async () => {
    const { db, storage, findUnique, createPresignedDownloadUrl } = createMockDeps();
    findUnique.mockResolvedValue({ id: ecuFileId, tenantId, storageKey: "key" });
    createPresignedDownloadUrl.mockResolvedValue({
      downloadUrl: "https://s3.example.com/x",
    });

    await downloadEcuFile(
      { db, storage },
      { tenantId, ecuFileId, requestedBy: { id: "user-1", role: Role.OWNER } },
    );

    expect(findUnique).toHaveBeenCalledWith({ where: { id: ecuFileId, tenantId } });
  });
});
