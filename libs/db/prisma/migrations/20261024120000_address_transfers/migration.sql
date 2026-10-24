-- Deposits and withdrawals, stored: every plain transfer of a tracked address
-- since it entered the system, and how far each address has been read. The
-- same two table names 20260908200000 dropped; the shape is new.

-- CreateTable
CREATE TABLE "AddressTransfer" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "leg" TEXT NOT NULL,
    "minedAt" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "counterparty" TEXT,
    "network" TEXT,
    "symbol" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "usd" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddressTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AddressTransferCursor" (
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "since" TIMESTAMP(3) NOT NULL,
    "syncedTo" TIMESTAMP(3),
    "passCursor" TEXT,
    "passFloor" TIMESTAMP(3),
    "passStartedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "retryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressTransferCursor_pkey" PRIMARY KEY ("chain","address")
);

-- CreateIndex
CREATE INDEX "AddressTransfer_chain_address_minedAt_idx" ON "AddressTransfer"("chain", "address", "minedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AddressTransfer_chain_address_txHash_leg_key" ON "AddressTransfer"("chain", "address", "txHash", "leg");
