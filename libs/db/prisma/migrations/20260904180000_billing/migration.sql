-- Svinooh.Pro: prepaid subscription time, the payments that bought it, and the
-- meters the free plan runs on.
--
-- Crypto has no dependable auto-debit, so a subscription here is not a charge
-- on file — it is paidUntil, moved forward by every finished payment and
-- nagged about by the reminder sweep. Whether somebody is Pro is
-- `paidUntil > now`; there is no status column to go stale.
CREATE TABLE "Subscription" (
    "userId" TEXT NOT NULL,
    "paidUntil" TIMESTAMP(3) NOT NULL,
    "remindedAt" TIMESTAMP(3),
    "expiredNoticeAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "Subscription_paidUntil_idx" ON "Subscription"("paidUntil");

ALTER TABLE "Subscription"
    ADD CONSTRAINT "Subscription_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One checkout attempt per row, created before the gateway is asked for an
-- invoice: a webhook naming an order we cannot find is then evidence of a bug,
-- never silent money. orderId is ours, unique, and what the webhook matches on.
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "providerPaymentId" TEXT,
    "months" INTEGER NOT NULL DEFAULT 1,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'created',
    "payCurrency" TEXT,
    "paidAmount" DOUBLE PRECISION,
    "invoiceUrl" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Payment_orderId_key" ON "Payment"("orderId");
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

ALTER TABLE "Payment"
    ADD CONSTRAINT "Payment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- What the free plan has spent. alertsSent is lifetime — the trial is the
-- first N alerts ever, and re-adding wallets must not refill it. The AI pair
-- is one day's count overwritten in place when the date rolls, instead of a
-- row per day that nothing reads after midnight.
CREATE TABLE "FeatureUsage" (
    "userId" TEXT NOT NULL,
    "alertsSent" INTEGER NOT NULL DEFAULT 0,
    "alertsUpsellAt" TIMESTAMP(3),
    "aiDay" TEXT,
    "aiUsed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureUsage_pkey" PRIMARY KEY ("userId")
);

ALTER TABLE "FeatureUsage"
    ADD CONSTRAINT "FeatureUsage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
