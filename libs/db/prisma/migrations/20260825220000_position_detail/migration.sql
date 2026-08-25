-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "note" TEXT,
ADD COLUMN     "apy" DOUBLE PRECISION,
ADD COLUMN     "healthRate" DOUBLE PRECISION,
ADD COLUMN     "tokens" JSONB;
