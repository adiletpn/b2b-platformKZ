-- AlterTable
ALTER TABLE "receipt_items" ADD COLUMN     "markingCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "ageConfirmed" BOOLEAN NOT NULL DEFAULT false;
