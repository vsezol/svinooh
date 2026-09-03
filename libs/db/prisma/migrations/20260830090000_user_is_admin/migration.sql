-- Who may change the system's tunables.
--
-- A column rather than a role table: there is one bit of authority in this
-- product and no prospect of a second, and a table would be three joins to
-- answer a question a boolean answers.
--
-- It is set in the database and nowhere else. Nothing in the product grants it,
-- so there is no flow to get wrong and no endpoint to find.
ALTER TABLE "User" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- The one account that has it today. By Telegram id rather than by user id,
-- because that is the identity that survives a database rebuild.
UPDATE "User" SET "isAdmin" = true WHERE "telegramId" = 891014622;
