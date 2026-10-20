-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('OPEN', 'RESOLVED');

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "messageId" TEXT;

-- CreateTable
CREATE TABLE "chat_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_complaints" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ComplaintStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_blocks" (
    "id" TEXT NOT NULL,
    "blockerCompanyId" TEXT NOT NULL,
    "blockedCompanyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chat_templates_companyId_idx" ON "chat_templates"("companyId");

-- CreateIndex
CREATE INDEX "chat_complaints_status_createdAt_idx" ON "chat_complaints"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_complaints_messageId_companyId_key" ON "chat_complaints"("messageId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_blocks_blockerCompanyId_blockedCompanyId_key" ON "chat_blocks"("blockerCompanyId", "blockedCompanyId");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_templates" ADD CONSTRAINT "chat_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_complaints" ADD CONSTRAINT "chat_complaints_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_complaints" ADD CONSTRAINT "chat_complaints_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_blockerCompanyId_fkey" FOREIGN KEY ("blockerCompanyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_blocks" ADD CONSTRAINT "chat_blocks_blockedCompanyId_fkey" FOREIGN KEY ("blockedCompanyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
