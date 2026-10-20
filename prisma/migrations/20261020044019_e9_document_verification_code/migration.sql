-- Код проверки документа для QR на печатной форме (раздел 4.4 ТЗ).
-- Колонка добавляется пустой, у существующих документов код заполняется случайным
-- UUID, и только потом становится обязательной: так миграция проходит на базе с данными.
ALTER TABLE "documents" ADD COLUMN "verificationCode" TEXT;

UPDATE "documents" SET "verificationCode" = gen_random_uuid()::text WHERE "verificationCode" IS NULL;

ALTER TABLE "documents" ALTER COLUMN "verificationCode" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "documents_verificationCode_key" ON "documents"("verificationCode");
