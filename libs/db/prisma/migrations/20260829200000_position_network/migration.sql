-- Which network a position actually sits on.
--
-- The scanners have always known: DeBank answers with a chain per project and
-- per token, and the Solana/Tron scanners only ever see one. It was folded into
-- the free text of `note` — first element of a "·"-joined line — where it could
-- be read by a person and by nothing else. Wallet.chain cannot stand in for it:
-- that is the family (EVM), and one EVM wallet holds positions on a dozen
-- networks.
ALTER TABLE "Position" ADD COLUMN "network" TEXT;
