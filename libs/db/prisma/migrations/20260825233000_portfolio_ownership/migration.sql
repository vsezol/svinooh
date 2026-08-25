-- A portfolio becomes a standalone entity: a group of wallets behind a slug.
-- Who owns it, and whether it may be listed publicly, move into their own table.
-- Everything that exists today becomes PRIVATE — privacy is the default, and
-- nobody opted in to being listed.
CREATE TABLE "PortfolioOwner" (
    "portfolioId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortfolioOwner_pkey" PRIMARY KEY ("portfolioId")
);

CREATE INDEX "PortfolioOwner_userId_idx" ON "PortfolioOwner"("userId");

ALTER TABLE "PortfolioOwner" ADD CONSTRAINT "PortfolioOwner_portfolioId_fkey"
    FOREIGN KEY ("portfolioId") REFERENCES "Portfolio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PortfolioOwner" ADD CONSTRAINT "PortfolioOwner_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "PortfolioOwner" ("portfolioId", "userId", "isPublic", "createdAt")
SELECT "id", "userId", false, "createdAt" FROM "Portfolio";

-- The auto-generated name embedded the owner's handle ("@user's portfolio").
-- A portfolio name is public whenever the portfolio is, so that name is a
-- deanonymization vector: reset the ones nobody renamed by hand.
UPDATE "Portfolio" SET "name" = 'My portfolio'
WHERE "name" LIKE '@%''s portfolio' OR "name" LIKE 'Портфель @%';

ALTER TABLE "Portfolio" DROP CONSTRAINT "Portfolio_userId_fkey";
ALTER TABLE "Portfolio" DROP COLUMN "userId";
