-- What a wallet is watched for. One row per wallet, written only by its owner;
-- a wallet with no row is a wallet on the defaults, not a wallet nobody can be
-- told about. A null threshold means nobody is watching it — which is not the
-- same as zero, a threshold that can never be crossed.
CREATE TABLE "WalletAlerts" (
    "walletId" TEXT NOT NULL,
    "rangeAlerts" BOOLEAN NOT NULL DEFAULT true,
    "healthFactorBelow" DOUBLE PRECISION,
    "borrowApyAbove" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WalletAlerts_pkey" PRIMARY KEY ("walletId")
);

ALTER TABLE "WalletAlerts"
    ADD CONSTRAINT "WalletAlerts_walletId_fkey"
    FOREIGN KEY ("walletId") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
