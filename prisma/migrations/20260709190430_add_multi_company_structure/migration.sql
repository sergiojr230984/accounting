-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- Seed the default company that every pre-existing row (and any app code
-- that doesn't yet pass a companyId) will be attached to via the column
-- defaults added below.
INSERT INTO "Company" ("id", "name", "createdAt", "updatedAt")
VALUES ('default-company', 'Default Company', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "CustomerInvoice" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "CustomerInvoiceItem" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "SupplierInvoice" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "SupplierInvoiceItem" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- AlterTable
ALTER TABLE "UploadedFile" ADD COLUMN     "companyId" TEXT NOT NULL DEFAULT 'default-company';

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "Customer_companyId_idx" ON "Customer"("companyId");

-- CreateIndex
CREATE INDEX "Supplier_companyId_idx" ON "Supplier"("companyId");

-- CreateIndex
CREATE INDEX "CustomerInvoice_companyId_idx" ON "CustomerInvoice"("companyId");

-- CreateIndex
CREATE INDEX "CustomerInvoiceItem_companyId_idx" ON "CustomerInvoiceItem"("companyId");

-- CreateIndex
CREATE INDEX "SupplierInvoice_companyId_idx" ON "SupplierInvoice"("companyId");

-- CreateIndex
CREATE INDEX "SupplierInvoiceItem_companyId_idx" ON "SupplierInvoiceItem"("companyId");

-- CreateIndex
CREATE INDEX "Payment_companyId_idx" ON "Payment"("companyId");

-- CreateIndex
CREATE INDEX "UploadedFile_companyId_idx" ON "UploadedFile"("companyId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoice" ADD CONSTRAINT "CustomerInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerInvoiceItem" ADD CONSTRAINT "CustomerInvoiceItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoice" ADD CONSTRAINT "SupplierInvoice_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierInvoiceItem" ADD CONSTRAINT "SupplierInvoiceItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadedFile" ADD CONSTRAINT "UploadedFile_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
