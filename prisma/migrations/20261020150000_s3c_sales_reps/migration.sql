-- AlterEnum
ALTER TYPE "PermissionSection" ADD VALUE 'SALES_REPS';

-- CreateTable
CREATE TABLE "sales_rep_stores" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_rep_stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_rep_visits" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "comment" TEXT NOT NULL,
    "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_rep_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sales_rep_stores_membershipId_idx" ON "sales_rep_stores"("membershipId");

-- CreateIndex
CREATE UNIQUE INDEX "sales_rep_stores_supplierId_storeId_key" ON "sales_rep_stores"("supplierId", "storeId");

-- CreateIndex
CREATE INDEX "sales_rep_visits_supplierId_storeId_visitedAt_idx" ON "sales_rep_visits"("supplierId", "storeId", "visitedAt");

-- AddForeignKey
ALTER TABLE "sales_rep_stores" ADD CONSTRAINT "sales_rep_stores_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_stores" ADD CONSTRAINT "sales_rep_stores_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_stores" ADD CONSTRAINT "sales_rep_stores_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_visits" ADD CONSTRAINT "sales_rep_visits_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_visits" ADD CONSTRAINT "sales_rep_visits_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "memberships"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_rep_visits" ADD CONSTRAINT "sales_rep_visits_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

