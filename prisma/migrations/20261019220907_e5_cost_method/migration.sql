-- CreateEnum
CREATE TYPE "CostMethod" AS ENUM ('AVERAGE', 'FIFO');

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "costMethod" "CostMethod" NOT NULL DEFAULT 'AVERAGE';
