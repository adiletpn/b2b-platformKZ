-- CreateTable
CREATE TABLE "stock_batches" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "costPrice" DECIMAL(14,2) NOT NULL,
    "expiresAt" DATE,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_batches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_batches_locationId_productId_expiresAt_idx" ON "stock_batches"("locationId", "productId", "expiresAt");

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
