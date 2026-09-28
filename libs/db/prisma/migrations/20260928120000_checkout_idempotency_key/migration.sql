-- One attempt to pay, named by the client's Idempotency-Key. Existing rows
-- keep NULL, and Postgres treats NULLs as distinct in a unique index, so they
-- never collide with each other or with a key.
ALTER TABLE "Payment" ADD COLUMN "idempotencyKey" TEXT;

CREATE UNIQUE INDEX "Payment_userId_idempotencyKey_key" ON "Payment"("userId", "idempotencyKey");
