-- CreateTable
CREATE TABLE "company_licenses" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "validUntil" DATE,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_licenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_licenses_companyId_key" ON "company_licenses"("companyId");

-- AddForeignKey
ALTER TABLE "company_licenses" ADD CONSTRAINT "company_licenses_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
