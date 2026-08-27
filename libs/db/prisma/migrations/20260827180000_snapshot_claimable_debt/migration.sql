-- What a wallet could collect and what it owed, at each reading.
-- Nullable on purpose: rows written before this release have neither, and
-- zero would be a claim about them that nobody made.
ALTER TABLE "WalletSnapshot" ADD COLUMN "claimableUsd" DOUBLE PRECISION;
ALTER TABLE "WalletSnapshot" ADD COLUMN "debtUsd" DOUBLE PRECISION;
