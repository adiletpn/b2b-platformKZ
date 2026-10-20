-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "substituteForId" TEXT;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_substituteForId_fkey" FOREIGN KEY ("substituteForId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
