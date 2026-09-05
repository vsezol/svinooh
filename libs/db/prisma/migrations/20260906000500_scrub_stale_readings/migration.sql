-- Scrub two stretches of history that recorded what the sources got wrong,
-- not what the wallets held.
--
-- SOL EiN7zK…cYNL: from 2026-09-04 21:12 UTC one replica behind Jupiter's
-- portfolio API served a price snapshot frozen at that hour (cbBTC $81.8k
-- against a live $79.7k), and every scan that landed on it stored a total
-- ~$280–300 above the truth. The chart reads as a sawtooth; the teeth carry
-- no information about the wallet. A tooth is a single reading that towers
-- over its own hour: the rule deletes a row that sits more than $120 above
-- the median of its address's readings within ±40 minutes. Genuine moves
-- survive it — a real step keeps its level long enough to BECOME the median
-- (verified against the real -$290 market drop of 17:44 the same day, whose
-- rows all keep), and the claim/borrow changes of the period are an order of
-- magnitude under the threshold. Only this address and only from the hour
-- the sick replica froze: nobody else's spikes are ours to judge.
--
-- TRON TEF8gN…rZfi3: between the owner unstaking everything (~16:05 UTC
-- 2026-09-05) and the scanner learning what unfrozenV2 is (19:39 the same
-- day), scans stored the wallet at the $3.50 that was liquid while 10,890
-- TRX waited out its unlock. The wallet never held less than ~$3,600 in that
-- window, so anything under $500 in it is the bug, not a balance.

DELETE FROM "AddressSnapshot" a
USING (
  SELECT s.id
  FROM "AddressSnapshot" s
  WHERE s."chain" = 'SOL'
    AND s."address" = 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL'
    AND s."createdAt" >= TIMESTAMPTZ '2026-09-04 21:00:00+00'
    AND s."totalUsd" - (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY n."totalUsd")
      FROM "AddressSnapshot" n
      WHERE n."chain" = s."chain"
        AND n."address" = s."address"
        AND n."createdAt" BETWEEN s."createdAt" - INTERVAL '40 minutes'
                              AND s."createdAt" + INTERVAL '40 minutes'
    ) > 120
) AS tooth
WHERE a."id" = tooth."id";

-- Twice, because in the densest hour the teeth OUTNUMBERED the honest rows:
-- with most of a ±40-minute window sitting on the stale level, the median IS
-- the stale level and one tooth hides behind the others. The first pass thins
-- the crowd; the second sees the honest median and takes the straggler. A
-- pass over already-clean data deletes nothing, so the repeat is idempotent.
DELETE FROM "AddressSnapshot" a
USING (
  SELECT s.id
  FROM "AddressSnapshot" s
  WHERE s."chain" = 'SOL'
    AND s."address" = 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL'
    AND s."createdAt" >= TIMESTAMPTZ '2026-09-04 21:00:00+00'
    AND s."totalUsd" - (
      SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY n."totalUsd")
      FROM "AddressSnapshot" n
      WHERE n."chain" = s."chain"
        AND n."address" = s."address"
        AND n."createdAt" BETWEEN s."createdAt" - INTERVAL '40 minutes'
                              AND s."createdAt" + INTERVAL '40 minutes'
    ) > 120
) AS tooth
WHERE a."id" = tooth."id";

DELETE FROM "AddressSnapshot"
WHERE "chain" = 'TRON'
  AND "address" = 'TEF8gN62a3v8cH956eGe2NNfPoZQsrZfi3'
  AND "createdAt" BETWEEN TIMESTAMPTZ '2026-09-05 16:00:00+00'
                      AND TIMESTAMPTZ '2026-09-05 19:40:00+00'
  AND "totalUsd" < 500;
