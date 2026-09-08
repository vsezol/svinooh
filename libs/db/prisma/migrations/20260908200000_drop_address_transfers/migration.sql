-- The deposits-and-withdrawals experiment is over. It came and went inside a
-- day; this puts the schema back where it started.
--
-- It was built to answer a real complaint — withdrawing $5,000 from $100,000
-- reads as −5% and is not a loss — and the arithmetic worked. What it could not
-- carry was the ground underneath: knowing whether a transfer crossed the
-- portfolio's edge means knowing every venue a wallet can move value into, and
-- a venue our scanners cannot see makes a deposit look exactly like a
-- withdrawal. There is no client-side check for that, only more special cases.
-- DeBank does not attempt it either, on the same data.
--
-- So the tables go rather than sit unread. Nothing else references them: no
-- foreign keys point in, and the two columns other code shares with this work
-- (Wallet.unbelievedReadings, and everything AddressSnapshot does) belong to
-- the scan arbitration, which stays.
--
-- The rows in Setting are the operator's own decisions about knobs that no
-- longer exist. Left behind they would be answered by nothing — every reader
-- resolves through the registry, and a key absent from it is refused — but a
-- table that reads as a list of decisions should not carry decisions about
-- things that are gone.

DROP TABLE IF EXISTS "AddressTransfer";
DROP TABLE IF EXISTS "AddressTransferCursor";

DELETE FROM "Setting" WHERE "key" LIKE 'flows.%';
