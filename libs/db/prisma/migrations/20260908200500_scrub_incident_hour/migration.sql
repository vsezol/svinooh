-- The rest of 2026-09-08, at a threshold the hour actually deserves.
--
-- 20260908181000_scrub_foreign_balances removes a reading that towers FOURFOLD
-- over its address's level on both sides. That number is right for a rule that
-- sweeps thirty days of every address: out there a bug and a real move are only
-- told apart by shape, and four times over is where the shape stops being
-- ambiguous.
--
-- It is far too conservative for one hour that is known to have gone wrong.
-- Between roughly 14:50 and 16:10 UTC the scanner wrote other addresses'
-- balances onto whatever it was reading, at whatever ratio those balances
-- happened to be — $1,166,714 onto a $7 wallet (166,000x), $183,789 onto a
-- $10,700 one (17x), and $38,712 onto that same wallet twenty minutes later,
-- which is 3.6x and survived the sweep. Chasing the survivors one address at a
-- time is how the last two migrations got written, and it does not converge:
-- the ratio was never the signal, the hour was.
--
-- So inside the hour the same two-sided test runs at 1.5x. What protects real
-- movement here is not the ratio, it is the two-sidedness: a spike is high
-- against the readings before it AND after it, while a deposit is high against
-- the ones before and unremarkable against the ones after. Lowering the ratio
-- inside a window with logged evidence of corruption costs a round trip
-- somebody made inside two hours, and buys every leftover at once — including
-- on portfolios not looked at by hand.
--
-- Both medians are taken over the address's whole history, not over the window,
-- so a candidate at the edge is still judged against real neighbours.
--
-- Idempotent, and cheap: the candidate set is three hours of one table.

WITH candidate AS (
  SELECT s."id", s."chain", s."address", s."createdAt", s."totalUsd"
  FROM "AddressSnapshot" s
  WHERE s."createdAt" BETWEEN TIMESTAMPTZ '2026-09-08 14:00:00+00'
                          AND TIMESTAMPTZ '2026-09-08 17:00:00+00'
    AND s."totalUsd" > 500
),
spike AS (
  SELECT c."id"
  FROM candidate c
  WHERE c."totalUsd" > 1.5 * COALESCE((
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b."totalUsd")
          FROM "AddressSnapshot" b
          WHERE b."chain" = c."chain" AND b."address" = c."address"
            AND b."createdAt" >= c."createdAt" - INTERVAL '2 hours'
            AND b."createdAt" <  c."createdAt"
        ), 'Infinity')
    AND c."totalUsd" > 1.5 * COALESCE((
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY f."totalUsd")
          FROM "AddressSnapshot" f
          WHERE f."chain" = c."chain" AND f."address" = c."address"
            AND f."createdAt" >  c."createdAt"
            AND f."createdAt" <= c."createdAt" + INTERVAL '2 hours'
        ), 'Infinity')
    -- And by an amount worth removing, so a dusty address whose level rounds
    -- near zero is not swept up by a ratio against nothing
    AND c."totalUsd" - GREATEST(
      COALESCE((
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b."totalUsd")
        FROM "AddressSnapshot" b
        WHERE b."chain" = c."chain" AND b."address" = c."address"
          AND b."createdAt" >= c."createdAt" - INTERVAL '2 hours'
          AND b."createdAt" <  c."createdAt"
      ), 0),
      COALESCE((
        SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY f."totalUsd")
        FROM "AddressSnapshot" f
        WHERE f."chain" = c."chain" AND f."address" = c."address"
          AND f."createdAt" >  c."createdAt"
          AND f."createdAt" <= c."createdAt" + INTERVAL '2 hours'
      ), 0)
    ) > 500
)
DELETE FROM "AddressSnapshot" a USING spike WHERE a."id" = spike."id";
