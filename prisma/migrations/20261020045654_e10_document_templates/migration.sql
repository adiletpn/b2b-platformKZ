-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "locale" "Locale" NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_templates_type_locale_isActive_idx" ON "document_templates"("type", "locale", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_type_locale_version_key" ON "document_templates"("type", "locale", "version");

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
