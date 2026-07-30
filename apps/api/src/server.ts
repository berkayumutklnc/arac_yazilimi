import { S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "./generated/prisma/client.js";
import { buildApp } from "./app.js";
import { S3EcuFileStorage } from "./storage/s3EcuFileStorage.js";
import { DiagServiceClient } from "./diagService/diagServiceClient.js";

const jwtSecret = process.env.JWT_ACCESS_SECRET;
if (!jwtSecret) {
  throw new Error(
    "JWT_ACCESS_SECRET ortam değişkeni zorunlu — bkz. apps/api/.env.example. Sabit/varsayılan bir sırla başlatma reddedildi.",
  );
}

const s3Bucket = process.env.S3_BUCKET;
if (!s3Bucket) {
  throw new Error(
    "S3_BUCKET ortam değişkeni zorunlu — bkz. apps/api/.env.example, docs/local-minio-setup.md.",
  );
}

// bkz. docs/local-minio-setup.md — yerel geliştirmede MinIO (S3 uyumlu),
// üretimde gerçek S3. forcePathStyle MinIO için zorunlu (virtual-hosted-style
// DNS çözümlemesi MinIO'da yok).
const s3Client = new S3Client({
  region: process.env.S3_REGION ?? "us-east-1",
  endpoint: process.env.S3_ENDPOINT,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials:
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
});
const storage = new S3EcuFileStorage(s3Client, s3Bucket);

// bkz. docs/adr/0009-workorder-diagnostic-report.md — yerel varsayılan,
// apps/diag-service'in uvicorn varsayılan portu (8000).
const diagServiceClient = new DiagServiceClient({
  baseUrl: process.env.DIAG_SERVICE_URL ?? "http://localhost:8000",
});

const prisma = new PrismaClient();
const app = buildApp(prisma, { jwtSecret, storage, diagServiceClient });

const port = Number(process.env.PORT ?? 3001);
app.listen({ port }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
