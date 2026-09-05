-- One crater row outlived 20260906000500_scrub_stale_readings.
--
-- That migration bounded the TRON scrub at 16:00 UTC because the first broken
-- GRID point sat at 16:05 — but grid timestamps are resampled onto a uniform
-- phase and say nothing exact about raw createdAt. The first post-unstake scan
-- landed just before 16:00, survived the window, and the chart's carry-forward
-- then painted its $3.50 across the whole scrubbed gap: twenty-two identical
-- (3.50, 0, 0) points from one surviving row, indistinguishable at a glance
-- from the scrub having missed entirely.
--
-- Same rule, honest bounds: the wallet held ~$3.6k on both sides of the
-- crater, so inside the widened window anything under $100 is the bug. The
-- statement is idempotent — on a clean table it deletes nothing.

DELETE FROM "AddressSnapshot"
WHERE "chain" = 'TRON'
  AND "address" = 'TEF8gN62a3v8cH956eGe2NNfPoZQsrZfi3'
  AND "createdAt" BETWEEN TIMESTAMPTZ '2026-09-05 15:00:00+00'
                      AND TIMESTAMPTZ '2026-09-05 20:00:00+00'
  AND "totalUsd" < 100;
