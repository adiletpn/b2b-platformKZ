-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "decidedAt" TIMESTAMP(3),
ADD COLUMN     "decision" "DiscrepancyDecision" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "decisionReason" TEXT;
