-- One due time, in place of five overlapping mechanisms.
--
-- "Should I scan this address now?" was answered by lastSyncedAt (when we last
-- managed it), scanQueuedAt with a TTL (a scan is already on its way), status
-- 'pending' plus a periodic sweep (one that never came back), and a queue-depth
-- gate (do not republish everything). They overlapped, and the gaps between
-- them are where addresses got stuck.
--
-- Now every one of those writes the same column instead.
ALTER TABLE "Wallet" ADD COLUMN "nextScanAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Carry the existing rhythm over rather than making everything due at once: an
-- address scanned a minute ago keeps its place in the queue, and one that has
-- never been scanned is due now, which is what the default already says.
--
-- The active interval, because it is the shorter of the two — the first scan
-- after this deploy re-decides the interval properly from who has been visiting,
-- and an address that turns out to be idle simply waits longer next time. The
-- other way round would leave a portfolio somebody is watching untouched for
-- half an hour after the migration.
UPDATE "Wallet"
   SET "nextScanAt" = "lastSyncedAt" + interval '5 minutes'
 WHERE "lastSyncedAt" IS NOT NULL;

-- A scan that was in flight when the deploy landed keeps its lease, so it is
-- not dispatched a second time by the first top-up on the new code.
UPDATE "Wallet"
   SET "nextScanAt" = GREATEST("nextScanAt", "scanQueuedAt" + interval '10 minutes')
 WHERE "scanQueuedAt" IS NOT NULL;

DROP INDEX IF EXISTS "Wallet_scanQueuedAt_idx";
ALTER TABLE "Wallet" DROP COLUMN "scanQueuedAt";

-- The producer's only query: what is due, oldest first.
CREATE INDEX "Wallet_nextScanAt_idx" ON "Wallet"("nextScanAt");
