-- Deposits and withdrawals are removed, the second time. Telling a plain
-- transfer from a DeFi call, a bridge or a swap leg took a different rule per
-- chain and still let bridges between a person's own wallets through, which is
-- not a number a return can be built on. The tables and everything read into
-- them go; nothing else references them.

DROP TABLE IF EXISTS "AddressTransfer";
DROP TABLE IF EXISTS "AddressTransferCursor";
