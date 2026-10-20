-- AlterTable
ALTER TABLE "Position" ADD COLUMN     "realized" JSONB;

-- CreateTable
CREATE TABLE "PositionYield" (
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PositionYield_pkey" PRIMARY KEY ("chain","address","key")
);

