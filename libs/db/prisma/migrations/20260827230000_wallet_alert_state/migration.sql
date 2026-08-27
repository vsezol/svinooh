-- What was last true of a position, so the next scan can tell what changed.
-- Keyed by the position key the scan announces rather than by a Position row:
-- those are deleted and rewritten every scan, so their ids would say everything
-- had closed and reopened at once.
CREATE TABLE "WalletAlertState" (
    "walletId" TEXT NOT NULL,
    "positionKey" TEXT NOT NULL,
    "inRange" BOOLEAN,
    "healthBreached" BOOLEAN NOT NULL DEFAULT false,
    "borrowBreached" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAlertState_pkey" PRIMARY KEY ("walletId","positionKey")
);

CREATE INDEX "WalletAlertState_walletId_idx" ON "WalletAlertState"("walletId");
