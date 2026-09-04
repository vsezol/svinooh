-- A Telegram chat as an alert delivery address for non-Telegram identities
ALTER TABLE "User" ADD COLUMN "alertChatId" BIGINT;

-- A TelegramLogin token that connects a chat to an existing user
ALTER TABLE "TelegramLogin" ADD COLUMN "connectUserId" TEXT;
