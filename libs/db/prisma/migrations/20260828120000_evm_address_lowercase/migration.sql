-- One spelling per address.
--
-- EVM addresses are hex and EIP-55 uses the CASE of the letters as a checksum,
-- so 0xAbCd… and 0xabcd… are the same address — and the checksummed form is what
-- wallets and explorers hand people to copy. The landing lowercased what it was
-- given; adding a wallet to an existing portfolio did not. Everything downstream
-- keys on the exact string (the scan groups in listGroups, the rows a result is
-- applied to, AddressSnapshot's history, @@unique([portfolioId, address])), so
-- one address in two spellings was two of everything: scanned twice on every
-- cycle forever, its history split into two half-series, and the same wallet
-- addable twice to one portfolio — where its balance was then counted twice in
-- the total.
--
-- Base58 chains are untouched: there the case IS part of the address.

-- History has no uniqueness to collide with, so lowercasing simply merges the
-- two half-series back into the one series they should always have been.
UPDATE "AddressSnapshot"
SET "address" = lower("address")
WHERE "chain" = 'EVM' AND "address" <> lower("address");

-- Wallet rows CAN collide: @@unique([portfolioId, address]) never saw the second
-- spelling on the way in, so one portfolio may hold the same address twice. Pair
-- each duplicate with the row that is keeping its place, so what is worth saving
-- can be moved across before it goes.
CREATE TEMP TABLE "evm_wallet_merge" AS
WITH "keep" AS (
  -- The row to keep per (portfolio, address as it will be spelled): whichever
  -- has actually been scanned most recently, and the older of two equals, since
  -- that is the one the portfolio has been showing.
  SELECT DISTINCT ON ("portfolioId", lower("address"))
         "id", "portfolioId", lower("address") AS "normalized"
  FROM "Wallet"
  WHERE "chain" = 'EVM'
  ORDER BY "portfolioId", lower("address"), "lastSyncedAt" DESC NULLS LAST, "createdAt"
)
SELECT "duplicate"."id" AS "loser", "keep"."id" AS "survivor"
FROM "Wallet" AS "duplicate"
JOIN "keep"
  ON "keep"."portfolioId" = "duplicate"."portfolioId"
 AND "keep"."normalized" = lower("duplicate"."address")
WHERE "duplicate"."chain" = 'EVM' AND "duplicate"."id" <> "keep"."id";

-- Alert settings are the owner's own writing, not derived data, so they move to
-- the survivor rather than dying with the duplicate — unless the survivor has
-- settings of its own, which win.
UPDATE "WalletAlerts" a
SET "walletId" = m."survivor"
FROM "evm_wallet_merge" m
WHERE a."walletId" = m."loser"
  AND NOT EXISTS (SELECT 1 FROM "WalletAlerts" s WHERE s."walletId" = m."survivor");

-- WalletAlertState has no foreign key to Wallet, so the delete below would leave
-- it orphaned instead of cascading. It is remembered state, not settings — the
-- next scan builds it again.
DELETE FROM "WalletAlertState"
WHERE "walletId" IN (SELECT "loser" FROM "evm_wallet_merge");

-- Positions, snapshots and any remaining alert row go with it (onDelete: Cascade)
DELETE FROM "Wallet"
WHERE "id" IN (SELECT "loser" FROM "evm_wallet_merge");

DROP TABLE "evm_wallet_merge";

-- Nothing left to collide with
UPDATE "Wallet"
SET "address" = lower("address")
WHERE "chain" = 'EVM' AND "address" <> lower("address");
