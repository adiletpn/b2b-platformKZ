-- CreateEnum
CREATE TYPE "BannerAudience" AS ENUM ('ALL', 'STORES', 'SUPPLIERS');

-- AlterEnum
ALTER TYPE "AttachmentKind" ADD VALUE 'VOICE';

-- AlterTable
ALTER TABLE "attachments" ADD COLUMN     "durationMs" INTEGER;

-- AlterTable
ALTER TABLE "receipt_items" ADD COLUMN     "pieces" INTEGER;

-- AlterTable
ALTER TABLE "retail_prices" ADD COLUMN     "piecePrice" DECIMAL(14,2),
ADD COLUMN     "piecesPerPack" INTEGER;

-- CreateTable
CREATE TABLE "banners" (
    "id" TEXT NOT NULL,
    "textRu" TEXT NOT NULL,
    "textKk" TEXT NOT NULL,
    "audience" "BannerAudience" NOT NULL DEFAULT 'ALL',
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "banners_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "banners_startsOn_endsOn_idx" ON "banners"("startsOn", "endsOn");

-- AddForeignKey
ALTER TABLE "banners" ADD CONSTRAINT "banners_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

