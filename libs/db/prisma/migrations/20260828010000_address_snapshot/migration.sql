-- Per-address history, decoupled from portfolio-scoped Wallet rows so it
-- survives a wallet being reused in another portfolio, or removed from one and
-- added to another. Written once per scan per (chain, address).
CREATE TABLE "AddressSnapshot" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "totalUsd" DOUBLE PRECISION NOT NULL,
    "claimableUsd" DOUBLE PRECISION,
    "debtUsd" DOUBLE PRECISION,
    "breakdown" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AddressSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AddressSnapshot_chain_address_createdAt_idx" ON "AddressSnapshot"("chain", "address", "createdAt");

-- Backfill from the old per-wallet-row history. An address held in several
-- portfolios recorded near-identical parallel snapshots (one per Wallet row);
-- collapse them to one history with DISTINCT ON (chain, address, createdAt),
-- breaking ties toward the larger total since a glitch only ever reads low.
-- The chosen source row's id is reused verbatim: DISTINCT ON yields one row per
-- group, so those ids stay unique, and it needs no uuid/extension.
INSERT INTO "AddressSnapshot" ("id", "chain", "address", "totalUsd", "claimableUsd", "debtUsd", "breakdown", "createdAt")
SELECT DISTINCT ON (w."chain", w."address", s."createdAt")
       s."id",
       w."chain",
       w."address",
       s."totalUsd",
       s."claimableUsd",
       s."debtUsd",
       s."breakdown",
       s."createdAt"
FROM "WalletSnapshot" s
JOIN "Wallet" w ON w."id" = s."walletId"
ORDER BY w."chain", w."address", s."createdAt", s."totalUsd" DESC;
