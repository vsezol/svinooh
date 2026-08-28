-- When this address was handed to a scan queue, and nothing yet has come back.
--
-- The producer used to answer "is this address already on its way?" from the
-- queue's own depth, and the queue cannot answer it: RabbitMQ's messageCount
-- reports READY messages, so an address a scanner had already prefetched was
-- invisible to it — while lastSyncedAt stays null until the result lands, so the
-- address also still read as due. Between those two blind spots a new wallet was
-- published again on every 15s tick for the whole length of its scan.
--
-- It sits beside lastSyncedAt because it is the same kind of fact: something
-- true of the (chain, address) a scan operates on, recorded on each portfolio's
-- row of that address. A claim covers every row for the address at once.
ALTER TABLE "Wallet" ADD COLUMN "scanQueuedAt" TIMESTAMP(3);

-- The producer reads this on every tick, alongside the address it groups by.
CREATE INDEX "Wallet_scanQueuedAt_idx" ON "Wallet"("scanQueuedAt");
