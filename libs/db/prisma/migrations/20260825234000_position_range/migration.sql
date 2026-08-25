-- Whether a concentrated-liquidity position is still inside its price range.
-- Derived by the scanners from the composition of the pair, since neither
-- DeBank nor Jupiter reports it.
ALTER TABLE "Position" ADD COLUMN "range" TEXT;
