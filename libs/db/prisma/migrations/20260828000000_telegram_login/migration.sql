-- A sign-in the site started and is still waiting on. In a table rather than in
-- memory because the bot and the gateway are separate services: only one
-- process may long-poll a bot token, so the one that hears the answer is not
-- the one the tab is asking.
CREATE TABLE "TelegramLogin" (
    "token" TEXT NOT NULL,
    "telegramId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "username" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramLogin_pkey" PRIMARY KEY ("token")
);

CREATE INDEX "TelegramLogin_expiresAt_idx" ON "TelegramLogin"("expiresAt");
