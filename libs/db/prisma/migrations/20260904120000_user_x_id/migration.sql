-- Sign-in with X: its own identity column, exactly as telegramId is
ALTER TABLE "User" ADD COLUMN "xId" TEXT;

CREATE UNIQUE INDEX "User_xId_key" ON "User"("xId");
