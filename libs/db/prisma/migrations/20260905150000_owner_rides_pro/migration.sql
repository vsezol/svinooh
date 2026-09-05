-- The owner's own account rides Pro without an invoice.
--
-- Same shape as the isAdmin grant (20260830090000_user_is_admin), and for the
-- same reason: set in the database and nowhere else — there is no way to hand
-- out Pro from the product, which is the point. Keyed by the same telegramId
-- that grant used. 2100 is "for as long as this system exists"; the upsert is
-- idempotent, and a database without that user (any fresh local one) is left
-- exactly as it was.
INSERT INTO "Subscription" ("userId", "paidUntil", "createdAt", "updatedAt")
SELECT id, TIMESTAMP '2100-01-01 00:00:00', now(), now()
FROM "User" WHERE "telegramId" = 891014622
ON CONFLICT ("userId") DO UPDATE SET "paidUntil" = EXCLUDED."paidUntil", "updatedAt" = now();
