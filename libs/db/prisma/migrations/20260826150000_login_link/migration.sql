-- A sign-in link the bot sends into the chat: opening it authenticates the
-- visitor as this user, on whatever device opened it.
CREATE TABLE "LoginLink" (
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginLink_pkey" PRIMARY KEY ("token")
);

CREATE INDEX "LoginLink_userId_idx" ON "LoginLink"("userId");
CREATE INDEX "LoginLink_expiresAt_idx" ON "LoginLink"("expiresAt");

ALTER TABLE "LoginLink" ADD CONSTRAINT "LoginLink_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
