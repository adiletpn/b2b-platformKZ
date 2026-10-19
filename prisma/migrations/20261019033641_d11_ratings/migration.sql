-- CreateTable
CREATE TABLE "ratings" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "authorCompanyId" TEXT NOT NULL,
    "targetCompanyId" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "score" DECIMAL(3,2) NOT NULL,
    "comment" TEXT,
    "reply" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ratings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ratings_targetCompanyId_createdAt_idx" ON "ratings"("targetCompanyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ratings_orderId_authorCompanyId_key" ON "ratings"("orderId", "authorCompanyId");

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_authorCompanyId_fkey" FOREIGN KEY ("authorCompanyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_targetCompanyId_fkey" FOREIGN KEY ("targetCompanyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
