-- CreateEnum
CREATE TYPE "SwipeActionType" AS ENUM ('LIKE', 'SKIP', 'FAV');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'SENT', 'ACCEPTED', 'CHANGED_BY_SUPPLIER', 'REJECTED', 'PICKING', 'SHIPPED', 'DELIVERED', 'ACCEPTED_BY_STORE', 'ACCEPTED_WITH_DISCREPANCY', 'AWAITING_PAYMENT', 'PAID', 'CLOSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "swipe_actions" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "action" "SwipeActionType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "swipe_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carts" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" TEXT NOT NULL,
    "cartId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "deliveryDate" DATE,
    "comment" TEXT,
    "totalWithVat" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "quantityOrdered" DECIMAL(12,3) NOT NULL,
    "quantityConfirmed" DECIMAL(12,3),
    "priceWithoutVat" DECIMAL(14,2) NOT NULL,
    "priceWithVat" DECIMAL(14,2) NOT NULL,
    "vatRateValue" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "swipe_actions_storeId_createdAt_idx" ON "swipe_actions"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "swipe_actions_storeId_offerId_idx" ON "swipe_actions"("storeId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "carts_locationId_key" ON "carts"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cartId_offerId_key" ON "cart_items"("cartId", "offerId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_number_key" ON "orders"("number");

-- CreateIndex
CREATE INDEX "orders_storeId_createdAt_idx" ON "orders"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_supplierId_createdAt_idx" ON "orders"("supplierId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_orderId_offerId_key" ON "order_items"("orderId", "offerId");

-- AddForeignKey
ALTER TABLE "swipe_actions" ADD CONSTRAINT "swipe_actions_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "swipe_actions" ADD CONSTRAINT "swipe_actions_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supplier_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cartId_fkey" FOREIGN KEY ("cartId") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supplier_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "supplier_offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
