import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { EmptyObjectBodyError, S3EcuFileStorage } from "./s3EcuFileStorage.js";

const bucket = "arac-yazilim-ecu-files";

// getSignedUrl saf bir imzalama işlemidir (SigV4) — ağa hiç çıkmaz, bu yüzden
// gerçek (ama sahte/statik kimlik bilgili) bir S3Client ile offline test
// edilebilir. Yalnızca readObjectSha256 gerçekten `client.send()` çağırır —
// onu ayrıca spy'lıyoruz.
function createTestClient(): S3Client {
  return new S3Client({
    region: "us-east-1",
    endpoint: "http://localhost:9000",
    forcePathStyle: true,
    credentials: { accessKeyId: "test-access-key", secretAccessKey: "test-secret-key" },
  });
}

describe("S3EcuFileStorage", () => {
  it("createPresignedUploadUrl: bucket/key içeren, süreli, imzalı bir URL üretir", async () => {
    const storage = new S3EcuFileStorage(createTestClient(), bucket);

    const result = await storage.createPresignedUploadUrl({ key: "tenant-1/vehicle-1/stage1.bin" });

    expect(result.key).toBe("tenant-1/vehicle-1/stage1.bin");
    const url = new URL(result.uploadUrl);
    expect(url.pathname).toContain(bucket);
    expect(url.pathname).toContain("tenant-1/vehicle-1/stage1.bin");
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(url.searchParams.get("X-Amz-Expires")).toBeTruthy();
  });

  it("createPresignedDownloadUrl: aynı şekilde süreli imzalı bir URL üretir", async () => {
    const storage = new S3EcuFileStorage(createTestClient(), bucket);

    const result = await storage.createPresignedDownloadUrl({ key: "tenant-1/vehicle-1/stage1.bin" });

    const url = new URL(result.downloadUrl);
    expect(url.searchParams.get("X-Amz-Signature")).toBeTruthy();
  });

  it("presigned URL'ler asla public-read ACL parametresi içermez (bucket private kalmalı)", async () => {
    const storage = new S3EcuFileStorage(createTestClient(), bucket);

    const upload = await storage.createPresignedUploadUrl({ key: "k" });
    const uploadUrl = new URL(upload.uploadUrl);
    expect(uploadUrl.searchParams.toString().toLowerCase()).not.toContain("acl");

    const download = await storage.createPresignedDownloadUrl({ key: "k" });
    const downloadUrl = new URL(download.downloadUrl);
    expect(downloadUrl.searchParams.toString().toLowerCase()).not.toContain("acl");
  });

  it("readObjectSha256: S3'ten okunan içeriğin gerçek SHA-256 hash'ini döner", async () => {
    const client = createTestClient();
    const content = Buffer.from("test ecu calibration content");
    const expectedHash = createHash("sha256").update(content).digest("hex");
    const send = vi.fn().mockResolvedValue({ Body: Readable.from([content]) });
    client.send = send;
    const storage = new S3EcuFileStorage(client, bucket);

    const hash = await storage.readObjectSha256({ key: "tenant-1/vehicle-1/stage1.bin" });

    expect(hash).toBe(expectedHash);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
  });

  it("readObjectSha256: S3 nesnesi Body içermeden dönerse EmptyObjectBodyError fırlatır", async () => {
    const client = createTestClient();
    client.send = vi.fn().mockResolvedValue({ Body: undefined });
    const storage = new S3EcuFileStorage(client, bucket);

    await expect(storage.readObjectSha256({ key: "missing-key" })).rejects.toBeInstanceOf(
      EmptyObjectBodyError,
    );
  });
});
