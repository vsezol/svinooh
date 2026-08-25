-- A portfolio is identified by its slug; a name is something its owner may add.
-- The auto-generated names have to go: "My portfolio" is first person and read
-- as nonsense by everyone else once a portfolio was published, and naming one
-- after the wallet it holds defeats the point of grouping several of them.
ALTER TABLE "Portfolio" ALTER COLUMN "name" DROP NOT NULL;

UPDATE "Portfolio" SET "name" = NULL
WHERE "name" = 'My portfolio'
   OR "name" LIKE '%…%';           -- shortAddress() form, e.g. "0xd8da…6045"
