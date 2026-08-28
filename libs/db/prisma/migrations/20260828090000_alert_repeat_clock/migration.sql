-- When the owner was last told about a breach that is still standing.
--
-- A health factor under the line and a borrow rate over it are conditions, not
-- events: they persist until somebody repays, adds collateral or changes what
-- they asked to be told. Announcing them once and then going quiet leaves the
-- one alert that mattered buried in a chat, so they are raised again on a fixed
-- interval, and this is the clock that says when. Null is "nothing outstanding"
-- — the columns are cleared when the breach clears.
--
-- Existing rows come out null, so a breach that is standing at deploy time is
-- announced once on the next scan and then falls into the repeat cadence.
ALTER TABLE "WalletAlertState" ADD COLUMN "healthNotifiedAt" TIMESTAMP(3);
ALTER TABLE "WalletAlertState" ADD COLUMN "borrowNotifiedAt" TIMESTAMP(3);
