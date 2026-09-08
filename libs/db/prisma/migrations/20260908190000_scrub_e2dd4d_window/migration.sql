-- The last of the 2026-09-08 incident, on the one address the general rule
-- cannot reach.
--
-- 20260908181000_scrub_foreign_balances deletes a reading that towers four
-- times over its address's level on both sides. That threshold is where a bug
-- stops being distinguishable from a real move by shape alone, and it is not
-- negotiable in a rule that runs over every address. But it leaves
-- 0xe2dd4d…b53e, which was stored at $38,359 against a true level of about
-- $27,400 — a factor of 1.4, and unmistakably the same incident.
--
-- What makes it safe to name here is that the level is not inferred from the
-- data being cleaned. The scanner logged this wallet either side of the window:
--
--     14:56  Suspicious drop 0xe2dd4d…: $27377.00 → $3662.00, re-read $3847.00
--     15:05  Suspicious drop 0xe2dd4d…: $27377.00 → $4585.00, re-read $4564.00
--     15:21  Suspicious drop 0xe2dd4d…: $38359.00 → $3615.00, re-read $3615.00
--     15:31  Suspicious drop 0xe2dd4d…: $38359.00 → $24991.00, re-read $28068.00
--     15:41  Suspicious drop 0xe2dd4d…: $38359.00 → $27387.00, re-read $27387.00
--
-- $27,377 going in and $27,387 coming out, with the owner confirming nothing
-- happened on the wallet. So inside this window the wallet held about $27,400,
-- and both the $38,359 above it and the $3.6-4.6k readings below it are the
-- source failing — the same hour, the same cause, the same wallet.
--
-- Hence a band rather than a ceiling: this incident threw readings in BOTH
-- directions, and a rule that only removed the spike would leave craters that
-- the chart's carry-forward paints just as wide. The bounds are generous
-- against the $27.4k the logs establish — a fifth below, a sixth above — so
-- ordinary movement inside the window survives and only what is nowhere near
-- the wallet's own level goes.
--
-- Only this address and only this hour. Idempotent on a clean table.

DELETE FROM "AddressSnapshot"
WHERE "chain" = 'EVM'
  AND "address" = '0xe2dd4d99f7fc9d0acbc73f52c4dc86a2dafdb53e'
  AND "createdAt" BETWEEN TIMESTAMPTZ '2026-09-08 14:50:00+00'
                      AND TIMESTAMPTZ '2026-09-08 16:00:00+00'
  AND ("totalUsd" > 32000 OR "totalUsd" < 22000);
