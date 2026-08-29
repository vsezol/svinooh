-- Wallet becomes the address; PortfolioWallet becomes the membership.
--
-- Until now a Wallet row was both at once — one per (portfolio, address) — so
-- an address in three portfolios was three rows carrying three copies of the
-- same scan state and three copies of the same positions. Everything that
-- scanned had to group them back together and then fan out again.
--
-- The whole migration turns on one choice: PortfolioWallet keeps the OLD Wallet
-- id. That row always *was* the membership, so every id already pointing at it
-- — WalletAlerts.walletId, WalletAlertState.walletId, and the /wallets/:id URLs
-- the browser holds — stays correct without moving a byte. What changes hands
-- is only which Wallet the membership points at.

-- 1. The membership table, seeded from the rows that were already memberships.
CREATE TABLE "PortfolioWallet" (
    "id"          TEXT NOT NULL,
    "portfolioId" TEXT NOT NULL,
    "walletId"    TEXT NOT NULL,
    "label"       TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioWallet_pkey" PRIMARY KEY ("id")
);

-- One surviving Wallet per (chain, address): the one scanned most recently, so
-- the positions we keep are the freshest set anybody had. NULLS LAST because a
-- never-scanned row must never win over one with real readings.
CREATE TEMPORARY TABLE "_canonical" AS
SELECT DISTINCT ON ("chain", "address")
       "id" AS "keep", "chain", "address"
FROM "Wallet"
ORDER BY "chain", "address", "lastSyncedAt" DESC NULLS LAST, "createdAt" ASC;

INSERT INTO "PortfolioWallet" ("id", "portfolioId", "walletId", "label", "createdAt")
SELECT w."id", w."portfolioId", c."keep", w."label", w."createdAt"
FROM "Wallet" w
JOIN "_canonical" c ON c."chain" = w."chain" AND c."address" = w."address";

-- 2. The duplicates go, and their Positions with them (ON DELETE CASCADE).
--    Nothing else hangs off a Wallet row: WalletAlerts and WalletAlertState are
--    keyed by the membership id, which is what PortfolioWallet now holds.
ALTER TABLE "WalletAlerts" DROP CONSTRAINT IF EXISTS "WalletAlerts_walletId_fkey";
DELETE FROM "Wallet" w WHERE NOT EXISTS (SELECT 1 FROM "_canonical" c WHERE c."keep" = w."id");

-- 3. Wallet is now only the address.
DROP INDEX IF EXISTS "Wallet_portfolioId_address_key";
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_portfolioId_fkey";
ALTER TABLE "Wallet" DROP COLUMN "portfolioId";
ALTER TABLE "Wallet" DROP COLUMN "label";
CREATE UNIQUE INDEX "Wallet_chain_address_key" ON "Wallet"("chain", "address");

-- 4. The alert tables were always about a membership. Say so.
ALTER TABLE "WalletAlerts" RENAME COLUMN "walletId" TO "portfolioWalletId";
ALTER TABLE "WalletAlertState" RENAME COLUMN "walletId" TO "portfolioWalletId";
ALTER INDEX "WalletAlertState_walletId_idx" RENAME TO "WalletAlertState_portfolioWalletId_idx";

-- A membership can disappear while its alert rows do not, so anything orphaned
-- goes before the foreign keys are put on.
DELETE FROM "WalletAlerts" a
 WHERE NOT EXISTS (SELECT 1 FROM "PortfolioWallet" p WHERE p."id" = a."portfolioWalletId");
DELETE FROM "WalletAlertState" s
 WHERE NOT EXISTS (SELECT 1 FROM "PortfolioWallet" p WHERE p."id" = s."portfolioWalletId");

-- 5. Wire it up.
CREATE UNIQUE INDEX "PortfolioWallet_portfolioId_walletId_key" ON "PortfolioWallet"("portfolioId", "walletId");
CREATE INDEX "PortfolioWallet_walletId_idx" ON "PortfolioWallet"("walletId");

ALTER TABLE "PortfolioWallet" ADD CONSTRAINT "PortfolioWallet_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioWallet" ADD CONSTRAINT "PortfolioWallet_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletAlerts" ADD CONSTRAINT "WalletAlerts_portfolioWalletId_fkey"
    FOREIGN KEY ("portfolioWalletId") REFERENCES "PortfolioWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WalletAlertState" ADD CONSTRAINT "WalletAlertState_portfolioWalletId_fkey"
    FOREIGN KEY ("portfolioWalletId") REFERENCES "PortfolioWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. WalletSnapshot has had no writer and no reader since AddressSnapshot took
--    over the charts. It was left behind rather than removed.
DROP TABLE IF EXISTS "WalletSnapshot";
