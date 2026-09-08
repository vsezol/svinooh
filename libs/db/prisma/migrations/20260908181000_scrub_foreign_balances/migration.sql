-- Remove the readings that recorded somebody else's wallet.
--
-- Until 2026-09-08 the writer doubted a reading only when it FELL: the rule was
-- "normal, or up", so any increase was stored on sight. A re-read was likewise
-- accepted on the single test that it was not itself a drop — no upper bound.
-- Between them, three totals belonging to other addresses were written onto one
-- $7 wallet inside half an hour ($827, then $449,833, then $1,166,714), and the
-- fall side of the same machinery then spent twenty-five minutes protecting the
-- last of them and rejecting the truth.
--
-- What that leaves in the history is a spike: a reading that towers over the
-- address's own level and is gone again by the next cycle. This deletes those,
-- and the chart's carry-forward closes the gap with the last good value.
--
-- The test is TWO-SIDED, and that is what makes it safe to run over every
-- address rather than a named one. A spike is high against the readings before
-- it AND against the readings after it. A genuine deposit is high against the
-- ones before and perfectly ordinary against the ones after, so it is never
-- touched — which is the difference this cannot afford to get wrong.
--
-- Deliberately conservative on size: four times the level on both sides, and at
-- least $500 above it. The incident's $1,166,714 on a $7 wallet is a factor of
-- 166,000; the $183,789 on a $10,700 one is 17. Below a few times over, a bug
-- and a real move are not distinguishable from the outside, and guessing there
-- would destroy real history to tidy up a chart. Those readings stay.
--
-- This runs inside the api container's start command, ahead of the healthcheck,
-- so it is written to be cheap rather than merely correct: `candidate` is one
-- indexed pass that throws away every address behaving normally, and only what
-- survives pays for the two medians. Without that pre-filter the two correlated
-- subqueries run per row over the whole window, which is minutes on a table
-- this size and a failed deploy at 120 seconds.
--
-- Idempotent: on a table with no spikes left it deletes nothing.

WITH level AS (
  -- What each address has been worth over the period, in one grouped pass
  SELECT "chain", "address",
         percentile_cont(0.5) WITHIN GROUP (ORDER BY "totalUsd") AS median
  FROM "AddressSnapshot"
  WHERE "createdAt" >= now() - INTERVAL '30 days'
  GROUP BY "chain", "address"
),
candidate AS (
  -- Readings that tower over their own address's level. A wallet behaving
  -- normally produces none at all, whatever its size, so the expensive test
  -- below is never reached for it.
  SELECT s."id", s."chain", s."address", s."createdAt", s."totalUsd"
  FROM "AddressSnapshot" s
  JOIN level l ON l."chain" = s."chain" AND l."address" = s."address"
  WHERE s."createdAt" >= now() - INTERVAL '30 days'
    AND s."totalUsd" > 500
    AND s."totalUsd" > 4 * l.median
    AND s."totalUsd" - l.median > 500
),
spike AS (
  SELECT c."id"
  FROM candidate c
  -- The two-sided test, paid for only by the handful of rows above.
  -- COALESCE to Infinity: a candidate with no readings on one side cannot be
  -- shown to be a spike, so it is left alone.
  WHERE c."totalUsd" > 4 * COALESCE((
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY b."totalUsd")
          FROM "AddressSnapshot" b
          WHERE b."chain" = c."chain" AND b."address" = c."address"
            AND b."createdAt" >= c."createdAt" - INTERVAL '2 hours'
            AND b."createdAt" <  c."createdAt"
        ), 'Infinity')
    AND c."totalUsd" > 4 * COALESCE((
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY f."totalUsd")
          FROM "AddressSnapshot" f
          WHERE f."chain" = c."chain" AND f."address" = c."address"
            AND f."createdAt" >  c."createdAt"
            AND f."createdAt" <= c."createdAt" + INTERVAL '2 hours'
        ), 'Infinity')
)
DELETE FROM "AddressSnapshot" a USING spike WHERE a."id" = spike."id";
