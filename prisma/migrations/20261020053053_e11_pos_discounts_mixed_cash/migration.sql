-- CreateEnum
CREATE TYPE "CashOperationType" AS ENUM ('CASH_IN', 'CASH_OUT');

-- AlterEnum
ALTER TYPE "ReceiptPaymentType" ADD VALUE 'MIXED';

-- AlterTable
ALTER TABLE "receipt_items" ADD COLUMN     "discount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "cardAmount" DECIMAL(14,2),
ADD COLUMN     "cashAmount" DECIMAL(14,2),
ADD COLUMN     "cashReceived" DECIMAL(14,2),
ADD COLUMN     "discountTotal" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "cash_operations" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "CashOperationType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_operations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cash_operations_shiftId_idx" ON "cash_operations"("shiftId");

-- AddForeignKey
ALTER TABLE "cash_operations" ADD CONSTRAINT "cash_operations_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "pos_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
