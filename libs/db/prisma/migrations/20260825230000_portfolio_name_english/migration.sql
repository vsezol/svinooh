-- Portfolios created before the codebase was translated got a Russian
-- auto-generated name ("Портфель @user"). Bring those in line with what
-- ensurePortfolio produces now ("@user's portfolio"). Rows whose name no longer
-- matches the old auto-generated pattern were renamed by their owner and are
-- left alone.
UPDATE "Portfolio"
SET "name" = replace("name", 'Портфель ', '') || '''s portfolio'
WHERE "name" LIKE 'Портфель %';
