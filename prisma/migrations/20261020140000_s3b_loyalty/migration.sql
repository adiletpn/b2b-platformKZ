-- CreateEnum
CREATE TYPE "LoyaltyMovementType" AS ENUM ('EARN', 'REDEEM', 'EARN_REVERSAL', 'REDEEM_REVERSAL');

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "bonusEarned" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "bonusRedeemed" DECIMAL(14,2) NOT NULL DEFAULT 0,
ADD COLUMN     "loyaltyCustomerId" TEXT;

-- CreateTable
CREATE TABLE "loyalty_customers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "balance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_movements" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "type" "LoyaltyMovementType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_customers_companyId_phone_key" ON "loyalty_customers"("companyId", "phone");

-- CreateIndex
CREATE INDEX "loyalty_movements_customerId_createdAt_idx" ON "loyalty_movements"("customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_loyaltyCustomerId_fkey" FOREIGN KEY ("loyaltyCustomerId") REFERENCES "loyalty_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_customers" ADD CONSTRAINT "loyalty_customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_movements" ADD CONSTRAINT "loyalty_movements_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "loyalty_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_movements" ADD CONSTRAINT "loyalty_movements_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

