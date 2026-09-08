-- What moved through an address, and what it was worth at the time.
--
-- Keyed by (chain, address) for the same reason AddressSnapshot is: it is a
-- fact about a public address, identical in every portfolio holding it, and it
-- has to outlive any single PortfolioWallet row. Whether a given transfer is a
-- deposit, a withdrawal or an internal move is NOT stored — that is a verdict
-- relative to one portfolio's set of addresses, and it is made at read time.
CREATE TABLE "AddressTransfer" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "txHash" TEXT NOT NULL,
    "idx" INTEGER NOT NULL,
    "minedAt" TIMESTAMP(3) NOT NULL,
    "direction" TEXT NOT NULL,
    "counterparty" TEXT,
    "network" TEXT,
    "operation" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "assetId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "priceUsd" DOUBLE PRECISION,
    "valueUsd" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddressTransfer_pkey" PRIMARY KEY ("id")
);

-- One transaction can move two assets (a swap), so the transfer's index inside
-- it is part of what makes a row unique — without it the second leg overwrites
-- the first on re-ingest.
CREATE UNIQUE INDEX "AddressTransfer_chain_address_txHash_idx_key"
    ON "AddressTransfer"("chain", "address", "txHash", "idx");

-- How every read of this table is shaped: one address, a window of time
CREATE INDEX "AddressTransfer_chain_address_minedAt_idx"
    ON "AddressTransfer"("chain", "address", "minedAt");

-- How far the transfer history of one address has been read. Separate from
-- Wallet because Wallet is what an address is WORTH and this is what we have
-- READ about it: different clocks, and a wallet row dropped by its last
-- portfolio must not take the ingest record with it.
CREATE TABLE "AddressTransferCursor" (
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "syncedTo" TIMESTAMP(3),
    "coveredFrom" TIMESTAMP(3),
    "cursor" TEXT,
    "nextSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AddressTransferCursor_pkey" PRIMARY KEY ("chain", "address")
);

-- The producer's only question: what has come due
CREATE INDEX "AddressTransferCursor_nextSyncAt_idx"
    ON "AddressTransferCursor"("nextSyncAt");
