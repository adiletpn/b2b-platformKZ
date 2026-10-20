-- AlterTable
ALTER TABLE "ratings" ADD COLUMN     "disputeReason" TEXT,
ADD COLUMN     "disputeResolution" TEXT,
ADD COLUMN     "disputeResolvedAt" TIMESTAMP(3),
ADD COLUMN     "disputedAt" TIMESTAMP(3),
ADD COLUMN     "hiddenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "approvedById" TEXT;
