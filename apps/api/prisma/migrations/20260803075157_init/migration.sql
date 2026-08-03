-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ENGINEER', 'RECEPTIONIST', 'DEALER', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "WorkOrderStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'IN_PROGRESS', 'AWAITING_PARTS', 'QUALITY_CHECK', 'DELIVERED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EcuFileType" AS ENUM ('ORIGINAL_STOCK', 'STAGE1', 'STAGE2', 'CUSTOM');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "WorkOrderItemType" AS ENUM ('SERVICE', 'PART');

-- CreateEnum
CREATE TYPE "VatRate" AS ENUM ('RATE_0', 'RATE_1', 'RATE_10', 'RATE_20');

-- CreateEnum
CREATE TYPE "FileRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'FULFILLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccessDeniedResource" AS ENUM ('ECU_FILE_DOWNLOAD', 'ECU_FILE_UPLOAD');

-- CreateEnum
CREATE TYPE "AccessDeniedReason" AS ENUM ('FORBIDDEN_ROLE', 'NOT_FOUND');

-- CreateEnum
CREATE TYPE "UserManagementAction" AS ENUM ('ROLE_CHANGED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "DiagnosticReportType" AS ENUM ('DTC', 'WOT');

-- CreateEnum
CREATE TYPE "DealerAccountStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "deactivatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserManagementAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "action" "UserManagementAction" NOT NULL,
    "fromRole" "Role",
    "toRole" "Role",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserManagementAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "nationalIdHash" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "vin" TEXT,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "affectsEnginePower" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ServiceType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "engineerId" TEXT,
    "status" "WorkOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "requiresAitmRegistration" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderItem" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "itemType" "WorkOrderItemType" NOT NULL,
    "description" TEXT NOT NULL,
    "serviceTypeId" TEXT,
    "quantity" INTEGER NOT NULL,
    "unitPriceKurus" INTEGER NOT NULL,
    "vatRate" "VatRate" NOT NULL,
    "netAmountKurus" INTEGER NOT NULL,
    "vatAmountKurus" INTEGER NOT NULL,
    "lineTotalKurus" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderComplianceStep" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "stepName" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "WorkOrderComplianceStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderStatusAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "fromStatus" "WorkOrderStatus" NOT NULL,
    "toStatus" "WorkOrderStatus" NOT NULL,
    "reason" TEXT,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderStatusAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcuFile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fileType" "EcuFileType" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "stockRomRef" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcuFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EcuFileDownloadAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "ecuFileId" TEXT NOT NULL,
    "downloadedBy" TEXT NOT NULL,
    "downloadedByRole" "Role" NOT NULL,
    "downloadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EcuFileDownloadAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccessDeniedAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "Role" NOT NULL,
    "resource" "AccessDeniedResource" NOT NULL,
    "resourceId" TEXT,
    "reason" "AccessDeniedReason" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessDeniedAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderDiagnosticReport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "reportType" "DiagnosticReportType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderDiagnosticReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealerAccount" (
    "id" TEXT NOT NULL,
    "hubTenantId" TEXT NOT NULL,
    "dealerTenantId" TEXT NOT NULL,
    "status" "DealerAccountStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "respondedAt" TIMESTAMP(3),
    "creditBalanceKurus" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealerAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealerCreditTransaction" (
    "id" TEXT NOT NULL,
    "dealerAccountId" TEXT NOT NULL,
    "amountKurus" INTEGER NOT NULL,
    "balanceAfterKurus" INTEGER NOT NULL,
    "fileRequestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DealerCreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileRequest" (
    "id" TEXT NOT NULL,
    "hubTenantId" TEXT NOT NULL,
    "dealerTenantId" TEXT NOT NULL,
    "dealerAccountId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "readFileId" TEXT NOT NULL,
    "requestedStage" "EcuFileType" NOT NULL,
    "status" "FileRequestStatus" NOT NULL DEFAULT 'PENDING',
    "costKurus" INTEGER,
    "resultFileId" TEXT,
    "requestedBy" TEXT NOT NULL,
    "processedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileRequestStatusAuditLog" (
    "id" TEXT NOT NULL,
    "fileRequestId" TEXT NOT NULL,
    "hubTenantId" TEXT NOT NULL,
    "dealerTenantId" TEXT NOT NULL,
    "fromStatus" "FileRequestStatus" NOT NULL,
    "toStatus" "FileRequestStatus" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileRequestStatusAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "invoiceNumber" TEXT,
    "issuedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "totalKurus" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceKurus" INTEGER NOT NULL,
    "vatRate" "VatRate" NOT NULL,
    "netAmountKurus" INTEGER NOT NULL,
    "vatAmountKurus" INTEGER NOT NULL,
    "lineTotalKurus" INTEGER NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountKurus" INTEGER NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceCounter" (
    "tenantId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceCounter_pkey" PRIMARY KEY ("tenantId","year")
);

-- CreateTable
CREATE TABLE "InvoiceStatusAuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "fromStatus" "InvoiceStatus" NOT NULL,
    "toStatus" "InvoiceStatus" NOT NULL,
    "reason" TEXT,
    "changedBy" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceStatusAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "Invitation_tenantId_idx" ON "Invitation"("tenantId");

-- CreateIndex
CREATE INDEX "UserManagementAuditLog_tenantId_idx" ON "UserManagementAuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "UserManagementAuditLog_targetUserId_idx" ON "UserManagementAuditLog"("targetUserId");

-- CreateIndex
CREATE INDEX "Customer_tenantId_idx" ON "Customer"("tenantId");

-- CreateIndex
CREATE INDEX "Vehicle_tenantId_idx" ON "Vehicle"("tenantId");

-- CreateIndex
CREATE INDEX "Vehicle_tenantId_plate_idx" ON "Vehicle"("tenantId", "plate");

-- CreateIndex
CREATE INDEX "WorkOrder_tenantId_idx" ON "WorkOrder"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderItem_workOrderId_idx" ON "WorkOrderItem"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderComplianceStep_workOrderId_idx" ON "WorkOrderComplianceStep"("workOrderId");

-- CreateIndex
CREATE INDEX "WorkOrderStatusAuditLog_tenantId_idx" ON "WorkOrderStatusAuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderStatusAuditLog_workOrderId_idx" ON "WorkOrderStatusAuditLog"("workOrderId");

-- CreateIndex
CREATE INDEX "EcuFile_tenantId_idx" ON "EcuFile"("tenantId");

-- CreateIndex
CREATE INDEX "EcuFile_vehicleId_idx" ON "EcuFile"("vehicleId");

-- CreateIndex
CREATE UNIQUE INDEX "EcuFile_tenantId_vehicleId_checksum_key" ON "EcuFile"("tenantId", "vehicleId", "checksum");

-- CreateIndex
CREATE INDEX "EcuFileDownloadAuditLog_tenantId_idx" ON "EcuFileDownloadAuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "EcuFileDownloadAuditLog_ecuFileId_idx" ON "EcuFileDownloadAuditLog"("ecuFileId");

-- CreateIndex
CREATE INDEX "AccessDeniedAuditLog_tenantId_idx" ON "AccessDeniedAuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderDiagnosticReport_tenantId_idx" ON "WorkOrderDiagnosticReport"("tenantId");

-- CreateIndex
CREATE INDEX "WorkOrderDiagnosticReport_workOrderId_idx" ON "WorkOrderDiagnosticReport"("workOrderId");

-- CreateIndex
CREATE INDEX "DealerAccount_hubTenantId_idx" ON "DealerAccount"("hubTenantId");

-- CreateIndex
CREATE INDEX "DealerAccount_dealerTenantId_idx" ON "DealerAccount"("dealerTenantId");

-- CreateIndex
CREATE UNIQUE INDEX "DealerAccount_hubTenantId_dealerTenantId_key" ON "DealerAccount"("hubTenantId", "dealerTenantId");

-- CreateIndex
CREATE INDEX "DealerCreditTransaction_dealerAccountId_idx" ON "DealerCreditTransaction"("dealerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "FileRequest_resultFileId_key" ON "FileRequest"("resultFileId");

-- CreateIndex
CREATE INDEX "FileRequest_hubTenantId_idx" ON "FileRequest"("hubTenantId");

-- CreateIndex
CREATE INDEX "FileRequest_dealerTenantId_idx" ON "FileRequest"("dealerTenantId");

-- CreateIndex
CREATE INDEX "FileRequest_vehicleId_idx" ON "FileRequest"("vehicleId");

-- CreateIndex
CREATE INDEX "FileRequestStatusAuditLog_fileRequestId_idx" ON "FileRequestStatusAuditLog"("fileRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_workOrderId_key" ON "Invoice"("workOrderId");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_invoiceNumber_key" ON "Invoice"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceStatusAuditLog_tenantId_idx" ON "InvoiceStatusAuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "InvoiceStatusAuditLog_invoiceId_idx" ON "InvoiceStatusAuditLog"("invoiceId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserManagementAuditLog" ADD CONSTRAINT "UserManagementAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserManagementAuditLog" ADD CONSTRAINT "UserManagementAuditLog_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderItem" ADD CONSTRAINT "WorkOrderItem_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderItem" ADD CONSTRAINT "WorkOrderItem_serviceTypeId_fkey" FOREIGN KEY ("serviceTypeId") REFERENCES "ServiceType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderComplianceStep" ADD CONSTRAINT "WorkOrderComplianceStep_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderStatusAuditLog" ADD CONSTRAINT "WorkOrderStatusAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderStatusAuditLog" ADD CONSTRAINT "WorkOrderStatusAuditLog_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcuFile" ADD CONSTRAINT "EcuFile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcuFile" ADD CONSTRAINT "EcuFile_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcuFile" ADD CONSTRAINT "EcuFile_stockRomRef_fkey" FOREIGN KEY ("stockRomRef") REFERENCES "EcuFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcuFileDownloadAuditLog" ADD CONSTRAINT "EcuFileDownloadAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EcuFileDownloadAuditLog" ADD CONSTRAINT "EcuFileDownloadAuditLog_ecuFileId_fkey" FOREIGN KEY ("ecuFileId") REFERENCES "EcuFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessDeniedAuditLog" ADD CONSTRAINT "AccessDeniedAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderDiagnosticReport" ADD CONSTRAINT "WorkOrderDiagnosticReport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderDiagnosticReport" ADD CONSTRAINT "WorkOrderDiagnosticReport_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealerAccount" ADD CONSTRAINT "DealerAccount_hubTenantId_fkey" FOREIGN KEY ("hubTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealerAccount" ADD CONSTRAINT "DealerAccount_dealerTenantId_fkey" FOREIGN KEY ("dealerTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealerCreditTransaction" ADD CONSTRAINT "DealerCreditTransaction_dealerAccountId_fkey" FOREIGN KEY ("dealerAccountId") REFERENCES "DealerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealerCreditTransaction" ADD CONSTRAINT "DealerCreditTransaction_fileRequestId_fkey" FOREIGN KEY ("fileRequestId") REFERENCES "FileRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_hubTenantId_fkey" FOREIGN KEY ("hubTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_dealerTenantId_fkey" FOREIGN KEY ("dealerTenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_dealerAccountId_fkey" FOREIGN KEY ("dealerAccountId") REFERENCES "DealerAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_readFileId_fkey" FOREIGN KEY ("readFileId") REFERENCES "EcuFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequest" ADD CONSTRAINT "FileRequest_resultFileId_fkey" FOREIGN KEY ("resultFileId") REFERENCES "EcuFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileRequestStatusAuditLog" ADD CONSTRAINT "FileRequestStatusAuditLog_fileRequestId_fkey" FOREIGN KEY ("fileRequestId") REFERENCES "FileRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceStatusAuditLog" ADD CONSTRAINT "InvoiceStatusAuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceStatusAuditLog" ADD CONSTRAINT "InvoiceStatusAuditLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
