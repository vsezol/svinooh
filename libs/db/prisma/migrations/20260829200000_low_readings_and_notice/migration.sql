-- Two memories that were being kept in the wrong place, or not at all.

-- The count of consecutive suspiciously-low readings lived in a Map inside the
-- result writer. That pinned the writer to one process forever, and every
-- redeploy silently reset it for every address — so a real fall had to be
-- argued from scratch each time we shipped. Existing addresses start at zero,
-- which is what the restart they last survived left them at anyway.
ALTER TABLE "Wallet" ADD COLUMN "lowReadings" INTEGER NOT NULL DEFAULT 0;

-- When we last told an owner their portfolio had gone quiet. Null means never,
-- which is correct for everybody today: nothing has ever sent this.
ALTER TABLE "PortfolioOwner" ADD COLUMN "slowedNoticeAt" TIMESTAMP(3);
