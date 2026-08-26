-- When a portfolio was last opened. It drives the rescan cadence: a portfolio
-- somebody is looking at stays fresh, one nobody has opened in a while drops to
-- a slow tier. Existing rows start as never-viewed, which is honest — we have
-- not been recording it.
ALTER TABLE "Portfolio" ADD COLUMN "lastViewedAt" TIMESTAMP(3);
