-- CreateEnum
CREATE TYPE "StockDocumentType" AS ENUM ('TRANSFER', 'WRITE_OFF', 'STOCKTAKE');

-- CreateEnum
CREATE TYPE "WriteOffReason" AS ENUM ('DAMAGE', 'EXPIRED', 'BREAKAGE', 'OTHER');

-- AlterTable
ALTER TABLE "stock_movements" ADD COLUMN     "stockDocumentId" TEXT;

-- CreateTable
CREATE TABLE "stock_documents" (
    "id" TEXT NOT NULL,
    "type" "StockDocumentType" NOT NULL,
    "number" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "targetLocationId" TEXT,
    "reason" "WriteOffReason",
    "comment" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_document_lines" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "expected" DECIMAL(12,3),
    "costPrice" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "stock_document_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_documents_companyId_createdAt_idx" ON "stock_documents"("companyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_documents_companyId_number_key" ON "stock_documents"("companyId", "number");

-- CreateIndex
CREATE INDEX "stock_document_lines_documentId_idx" ON "stock_document_lines"("documentId");

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_targetLocationId_fkey" FOREIGN KEY ("targetLocationId") REFERENCES "locations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_documents" ADD CONSTRAINT "stock_documents_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "stock_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_document_lines" ADD CONSTRAINT "stock_document_lines_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stockDocumentId_fkey" FOREIGN KEY ("stockDocumentId") REFERENCES "stock_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
