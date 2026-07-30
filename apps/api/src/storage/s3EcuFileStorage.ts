import { createHash } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { EcuFileStoragePort } from "../modules/ecufile/ecuFileUpload.service.js";
import type { EcuFileDownloadStoragePort } from "../modules/ecufile/ecuFileDownload.service.js";

const PRESIGNED_URL_EXPIRY_SECONDS = 15 * 60;

export class EmptyObjectBodyError extends Error {
  constructor(key: string) {
    super(`S3 nesnesi boş döndü (Body yok): ${key}`);
    this.name = "EmptyObjectBodyError";
  }
}

// Gerçek S3/MinIO adaptörü — hem yükleme (EcuFileStoragePort) hem indirme
// (EcuFileDownloadStoragePort) portlarını uygular (bkz. docs/adr/0008,
// docs/local-minio-setup.md). `S3Client` constructor'a enjekte edilir (DI) —
// testte fake/gerçek-ama-fake-credential'lı bir client, üretimde server.ts'in
// env'den kurduğu gerçek client. Bucket'ın kendisi HER ZAMAN private kalmalı
// (bkz. docs/local-minio-setup.md, `mc anonymous set none`) — bu sınıf bilinçli
// olarak hiçbir zaman `ACL: public-read` göndermez, tek erişim yolu bu
// sınıfın ürettiği süreli presigned URL'lerdir.
export class S3EcuFileStorage implements EcuFileStoragePort, EcuFileDownloadStoragePort {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
  ) {}

  async createPresignedUploadUrl(params: { key: string }): Promise<{ uploadUrl: string; key: string }> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: params.key });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });
    return { uploadUrl, key: params.key };
  }

  async createPresignedDownloadUrl(params: { key: string }): Promise<{ downloadUrl: string }> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: params.key });
    const downloadUrl = await getSignedUrl(this.client, command, {
      expiresIn: PRESIGNED_URL_EXPIRY_SECONDS,
    });
    return { downloadUrl };
  }

  async readObjectSha256(params: { key: string }): Promise<string> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: params.key }),
    );
    if (!response.Body) {
      throw new EmptyObjectBodyError(params.key);
    }

    const hash = createHash("sha256");
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      hash.update(chunk);
    }
    return hash.digest("hex");
  }
}
