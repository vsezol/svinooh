-- PortfolioSnapshot has been write-only since a9713dd ("Track wallet history
-- per address, not per portfolio-scoped row"): every chart is assembled from
-- AddressSnapshot, and nothing reads this table anywhere. The wallet service
-- stops writing it in the same release. A scan handled by a pre-release wallet
-- build in the deploy window logs one failed create and loses nothing: the
-- wallet's value and its AddressSnapshot are stored before this write ran, and
-- the consumer acks either way.

-- DropForeignKey
ALTER TABLE "PortfolioSnapshot" DROP CONSTRAINT "PortfolioSnapshot_portfolioId_fkey";

-- DropTable
DROP TABLE "PortfolioSnapshot";
