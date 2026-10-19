-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "creditLimit" DECIMAL(14,2),
ADD COLUMN     "deferralDays" INTEGER,
ADD COLUMN     "paymentTerms" "PaymentMethod" NOT NULL DEFAULT 'ON_DELIVERY';

-- AlterTable
ALTER TABLE "delivery_zones" ADD COLUMN     "deliveryDays" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- CreateTable
CREATE TABLE "price_lists" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "storeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_rules" (
    "id" TEXT NOT NULL,
    "priceListId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "priceWithVat" DECIMAL(14,2),
    "discountPercent" DECIMAL(5,2),
    "minQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "isPromo" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" DATE,
    "validTo" DATE,

    CONSTRAINT "price_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_lists_supplierId_idx" ON "price_lists"("supplierId");

-- CreateIndex
CREATE INDEX "price_rules_offerId_idx" ON "price_rules"("offerId");

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_rules" ADD CONSTRAINT "price_rules_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supplier_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
