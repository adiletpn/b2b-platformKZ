-- CreateTable
CREATE TABLE "owner_transfers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "fromMembership" TEXT NOT NULL,
    "toMembership" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "owner_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "owner_transfers_companyId_createdAt_idx" ON "owner_transfers"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "owner_transfers" ADD CONSTRAINT "owner_transfers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
