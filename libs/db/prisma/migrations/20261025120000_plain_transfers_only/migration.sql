-- The transfer history was stored on Zerion's word that a transaction was a
-- send or a receive, and on Solana and EVM that word covers Kamino deposits,
-- Meteora withdrawals, bridges and swap legs alike. Transfers are now kept only
-- when the transaction itself was nothing but a transfer, so what was stored
-- under the old rule goes, and every address is read again from its `since`.

DELETE FROM "AddressTransfer";
DELETE FROM "AddressTransferCursor";
