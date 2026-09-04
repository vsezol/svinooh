-- The owner's "hide small balances" switch, so it survives a refresh and a
-- device change. On PortfolioOwner rather than Portfolio: it is one person's
-- way of reading the numbers, like visibility is one person's decision to
-- publish them, and a portfolio nobody owns has nobody to remember it for.
ALTER TABLE "PortfolioOwner" ADD COLUMN "hideSmallBalances" BOOLEAN NOT NULL DEFAULT false;
