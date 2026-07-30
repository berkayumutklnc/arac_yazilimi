import type { PrismaClient } from "../generated/prisma/client.js";
import type { WorkOrderTransitionDb } from "../modules/workorder/workOrderTransition.service.js";
import type { WorkOrderComplianceDb } from "../modules/workorder/workOrderCompliance.service.js";
import type { WorkOrderCrudDb } from "../modules/workorder/workOrderCrud.service.js";
import type { EcuFileDb } from "../modules/ecufile/ecuFile.service.js";
import type { EcuFileDownloadDb } from "../modules/ecufile/ecuFileDownload.service.js";
import type { EcuFileUploadDb } from "../modules/ecufile/ecuFileUpload.service.js";
import type { EcuFileListDb } from "../modules/ecufile/ecuFileList.service.js";
import type { AccessDeniedAuditLogDb } from "../security/accessDeniedAudit.js";
import type { WorkOrderDiagnosticsDb } from "../modules/workorder/workOrderDiagnostics.service.js";

// Tenant-scoped görünümün tam tipi — request.tenantDb bu tipi taşır ve her
// servisin beklediği dar XxxDb arayüzleriyle doğrudan yapısal olarak uyumludur.
// Bilinçli olarak İÇERMEZ: FileRequestDb / FulfillFileRequestDb (dealer/hub
// modelleri extension kapsamı dışı, bkz. ADR 0006).
export type AppScopedDb = WorkOrderTransitionDb &
  WorkOrderComplianceDb &
  WorkOrderCrudDb &
  EcuFileDb &
  EcuFileDownloadDb &
  EcuFileUploadDb &
  EcuFileListDb &
  AccessDeniedAuditLogDb &
  WorkOrderDiagnosticsDb;

// Tek bir `tenantId` kolonu taşıyan modeller — bkz. docs/adr/0006, "Model
// Kapsamı Tablosu". DealerAccount/FileRequest/FileRequestStatusAuditLog/
// DealerCreditTransaction BİLİNÇLİ OLARAK burada değil: iki-tenant ilişkisi
// (hubTenantId/dealerTenantId), otomatik "benim tenant'ım" filtresi bunlar
// için YANLIŞ sonuç verir.
const TENANT_SCOPED_MODELS: ReadonlySet<string> = new Set([
  "User",
  "Customer",
  "Vehicle",
  "WorkOrder",
  "EcuFile",
  "WorkOrderStatusAuditLog",
  "EcuFileDownloadAuditLog",
  "Invoice",
  "AccessDeniedAuditLog",
  "WorkOrderDiagnosticReport",
]);

const READ_OR_WHERE_OPERATIONS: ReadonlySet<string> = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
  "update",
  "updateMany",
  "delete",
  "deleteMany",
  "upsert",
]);

export class CrossTenantAccessError extends Error {
  constructor(model: string) {
    super(
      `${model} sorgusunda çakışan tenantId tespit edildi — mevcut oturumun tenant'ı ile uyuşmuyor.`,
    );
    this.name = "CrossTenantAccessError";
  }
}

/**
 * Saf enjeksiyon/doğrulama mantığı — DB'ye hiç dokunmaz, bu yüzden gerçek
 * Prisma client olmadan tam kapsamlı test edilebilir. `createTenantScopedDb`
 * bunu `$extends()` üzerinden gerçek sorgulara bağlar (bkz. aşağı).
 */
export function applyTenantScope(
  model: string,
  operation: string,
  args: Record<string, unknown>,
  tenantId: string,
): Record<string, unknown> {
  if (!TENANT_SCOPED_MODELS.has(model)) {
    return args;
  }

  const next = { ...args };

  if (READ_OR_WHERE_OPERATIONS.has(operation)) {
    const where = { ...(next.where as Record<string, unknown> | undefined) };
    if ("tenantId" in where && where.tenantId !== tenantId) {
      throw new CrossTenantAccessError(model);
    }
    next.where = { ...where, tenantId };
  }

  if (operation === "create") {
    const data = { ...(next.data as Record<string, unknown> | undefined) };
    if ("tenantId" in data && data.tenantId !== tenantId) {
      throw new CrossTenantAccessError(model);
    }
    next.data = { ...data, tenantId };
  }

  if (operation === "createMany" && Array.isArray(next.data)) {
    next.data = (next.data as Record<string, unknown>[]).map((row) => {
      if ("tenantId" in row && row.tenantId !== tenantId) {
        throw new CrossTenantAccessError(model);
      }
      return { ...row, tenantId };
    });
  }

  return next;
}

/**
 * Request başına bir kez çağrılır (authPreHandler): `tenantId`, doğrulanmış
 * JWT'den (`request.authContext.tenantId`) gelir — hiçbir zaman istek
 * gövdesinden/sorgu parametresinden değil. Dönen nesne, servislerin
 * beklediği dar `XxxDb` arayüzleriyle yapısal olarak uyumludur; o arayüzlerde
 * `tenantId` alanı hiç yoktur, yani servis kodu onu elle geçemez (bkz. ADR 0006).
 *
 * Prisma'nın `$extends()` callback tipleri (`runtime.Types.Extensions.*`)
 * son derece karmaşık generic makine — burada saf `applyTenantScope`'a
 * yönlendiren ince bir bağlantı katmanından ibaret; asıl güvenlik mantığı
 * yukarıda tam tipli ve test edilmiş.
 *
 * Ayrıca: Prisma'nın `query` extension bileşeni ÇALIŞMA ZAMANI davranışını
 * değiştirir ama TypeScript imzalarını değiştirmez — üretilen tip hâlâ
 * `tenantId`'nin `create`/`update` çağrılarında elle verilmesini "gerekli"
 * gösterir (çünkü Prisma'nın kendi üretilen tipleri NOT NULL kolonu zorunlu
 * sayar). Bu, extension'ın gerçek (tenantId'yi otomatik dolduran) davranışını
 * ifade edemeyen bilinen bir Prisma sınırlaması. Bu yüzden dönüş tipi TEK bir
 * yerde, açıkça gerekçelendirilerek `AppScopedDb`'ye cast ediliyor — servis
 * kodu bu narrow tipi kullanır ve tenantId'yi hiç göremez/geçemez.
 */
export function createTenantScopedDb(prisma: PrismaClient, tenantId: string): AppScopedDb {
  const extended = prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma'nın $allOperations imzası aşırı karmaşık generic tip üretiyor, applyTenantScope'a devrediyoruz.
        $allOperations({ model, operation, args, query }: any) {
          const scopedArgs = applyTenantScope(
            model as string,
            operation as string,
            args as Record<string, unknown>,
            tenantId,
          );
          // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- bkz. yukarıdaki not.
          return query(scopedArgs);
        },
      },
    },
  });
  return extended as unknown as AppScopedDb;
}
