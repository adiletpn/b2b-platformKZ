-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "notificationChannels" TEXT[] DEFAULT ARRAY['whatsapp', 'telegram', 'email']::TEXT[];
