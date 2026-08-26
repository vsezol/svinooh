-- What the debt on a position costs, so the portfolio can show an average
-- borrow APY next to its total debt.
ALTER TABLE "Position" ADD COLUMN "borrowApy" DOUBLE PRECISION;
