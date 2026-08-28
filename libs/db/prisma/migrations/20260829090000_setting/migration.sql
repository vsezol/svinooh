-- One tunable, as the admin last set it.
--
-- Only changed keys get a row. Everything else falls through to the environment
-- and then to the default in libs/settings/registry.json, so an empty table is a
-- system running exactly as it shipped and the table reads as a list of
-- decisions rather than a second copy of the defaults.
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);
