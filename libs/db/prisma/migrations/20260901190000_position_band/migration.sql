-- Where inside its range a liquidity position is sitting.
--
-- The scanners have computed this all along — `enrich` builds a PositionBand
-- from the pool facts and uses it to decide `range` — and then dropped it. So
-- a position could say "in range" and never say how close to the edge, which
-- is most of what an LP wants to know.
ALTER TABLE "Position" ADD COLUMN "band" JSONB;
