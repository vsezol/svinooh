-- Tron resources: what a wallet can spend, and what it has lent out.
--
-- Tron charges in resources rather than in TRX — energy runs contract calls,
-- bandwidth pays for a transaction's bytes — and staked TRX can be delegated to
-- another account, which locks and later unlocks. The moment it unlocks is
-- something its owner wants to act on, so it is worth both showing and alerting
-- on. None of that is derivable from the balances we already scan.

-- One JSON value beside breakdown/unpriced rather than ten columns: nothing
-- queries by energy, it is rendered and compared against itself.
ALTER TABLE "Wallet" ADD COLUMN "tronResources" JSONB;
-- Reading resources costs four or more sequential rate-limited TronGrid calls,
-- so they are refreshed on their own slower clock instead of on every sync.
-- This is what tells a scan whether it owes one.
ALTER TABLE "Wallet" ADD COLUMN "tronResourcesAt" TIMESTAMP(3);

-- Both default to on, like range alerts: somebody who adds a Tron wallet wants
-- to hear that a delegation came free, and the two are one-way — they say
-- something became POSSIBLE, never that it stopped being.
ALTER TABLE "WalletAlerts" ADD COLUMN "tronReclaimAlerts" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "WalletAlerts" ADD COLUMN "tronDelegateAlerts" BOOLEAN NOT NULL DEFAULT true;

-- What was last true, so a transition can be told from a state that simply
-- persists. Default false, which also makes the first sighting a silent
-- baseline for a wallet that already has these rows.
ALTER TABLE "WalletAlertState" ADD COLUMN "reclaimArmed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WalletAlertState" ADD COLUMN "delegateArmed" BOOLEAN NOT NULL DEFAULT false;
