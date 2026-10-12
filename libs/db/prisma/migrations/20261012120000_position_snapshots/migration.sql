-- CreateTable
CREATE TABLE "PositionSnapshot" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "valueUsd" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION,
    "priceUsd" DOUBLE PRECISION,
    "tokens" JSONB,
    "band" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PositionSnapshot_chain_address_key_createdAt_idx" ON "PositionSnapshot"("chain", "address", "key", "createdAt");

