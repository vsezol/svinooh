-- A wallet becomes a third way to sign in, beside Telegram and X — and a third
-- identity, not a link to an existing one. The address is stored exactly as its
-- chain spells it: base58 is case-sensitive, so a Solana address cannot be
-- folded to lower case the way a hex one can.
ALTER TABLE "User" ADD COLUMN "walletAddress" TEXT;

CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");

-- The message an address was asked to sign, kept until the signature returns.
-- Deleted the moment it is spent, which is what stops a captured signature
-- being redeemed twice.
CREATE TABLE "WalletLogin" (
    "nonce" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletLogin_pkey" PRIMARY KEY ("nonce")
);

CREATE INDEX "WalletLogin_expiresAt_idx" ON "WalletLogin"("expiresAt");
