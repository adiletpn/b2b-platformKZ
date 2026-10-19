/*
  Warnings:

  - A unique constraint covering the columns `[storeId,number]` on the table `orders` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "orders_number_key";

-- CreateIndex
CREATE UNIQUE INDEX "orders_storeId_number_key" ON "orders"("storeId", "number");
