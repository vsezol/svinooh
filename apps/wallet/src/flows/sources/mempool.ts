import { Logger } from '@nestjs/common';
import { fetchJson } from '../../scanners/http';
import { historicalPrices, priceAt } from './historical-price';
import type { FlowSource, RawTransfer, TransferPage } from './source';

const logger = new Logger('BtcTransfers');
const PRIMARY = 'https://mempool.space/api';
const FALLBACK = 'https://blockstream.info/api';
const COIN = 'coingecko:bitcoin';

/**
 * Bitcoin transfers from mempool.space, with blockstream.info behind it — the
 * same pair, in the same order and for the same reason, as the BTC balance
 * scanner (scanners/btc.ts): from a datacenter IP mempool.space is sometimes
 * simply unreachable, and the two speak an identical format.
 *
 * Bitcoin does not have transfers. It has transactions that consume some
 * outputs and create others, and "what this address did" is the NET of the two:
 * everything paid to it, less everything spent from it. So one transaction
 * produces at most one row here, not one per output, and the amount is a
 * signed-then-absolute delta rather than anything the transaction states.
 *
 * The counterparty is a guess and is documented as one. A transaction with four
 * inputs and three outputs has no single other side; what is recorded is the
 * largest address on the other end — the one a person would name if asked where
 * the money went. It is only ever used to ask "is this one of the portfolio's
 * own addresses", where a wrong guess costs a move being called external, and
 * never to attribute money to anybody.
 *
 * Price is BTC at the hour it was mined, from DefiLlama in one batch per page —
 * the same helper TRON uses. mempool.space has its own historical-price
 * endpoint, but it answers one timestamp per request, which is a request per
 * transaction.
 */

interface Vout {
  scriptpubkey_address?: string;
  value?: number;
}

interface BtcTx {
  txid?: string;
  status?: { confirmed?: boolean; block_time?: number };
  vin?: Array<{ prevout?: Vout | null }>;
  vout?: Vout[];
}

async function txs(address: string, after: string | null): Promise<BtcTx[]> {
  const path = `/address/${address}/txs/chain${after ? `/${after}` : ''}`;
  try {
    return await fetchJson<BtcTx[]>(`${PRIMARY}${path}`);
  } catch {
    return fetchJson<BtcTx[]>(`${FALLBACK}${path}`);
  }
}

/** Everything paid to `address` in this transaction, in sats */
const paidTo = (tx: BtcTx, address: string): number =>
  (tx.vout ?? []).reduce(
    (sum, out) => sum + (out.scriptpubkey_address === address ? (out.value ?? 0) : 0),
    0,
  );

/** Everything spent from `address` in this transaction, in sats */
const spentFrom = (tx: BtcTx, address: string): number =>
  (tx.vin ?? []).reduce(
    (sum, input) =>
      sum + (input.prevout?.scriptpubkey_address === address ? (input.prevout.value ?? 0) : 0),
    0,
  );

/**
 * The biggest address on the other side of the move. For money leaving, that is
 * the largest output that is not our own change; for money arriving, the
 * largest input that is not us.
 */
function otherSide(tx: BtcTx, address: string, direction: 'in' | 'out'): string | null {
  const candidates: Vout[] =
    direction === 'out'
      ? (tx.vout ?? [])
      : (tx.vin ?? []).map((i) => i.prevout ?? {}).filter((p): p is Vout => p !== null);

  let best: { address: string; value: number } | null = null;
  for (const c of candidates) {
    const who = c.scriptpubkey_address;
    if (!who || who === address) continue;
    const value = c.value ?? 0;
    if (!best || value > best.value) best = { address: who, value };
  }
  return best?.address ?? null;
}

export const mempoolTransfers: FlowSource = {
  name: 'mempool',

  async read(address, { until, cursor }): Promise<TransferPage> {
    // mempool pages by "the last txid I saw", 25 confirmed transactions at a
    // time, newest first. There is no page size to ask for and no time filter —
    // `until` is applied here instead, and reaching it ends the paging.
    const rows = await txs(address, cursor);

    const plain: Array<Omit<RawTransfer, 'priceUsd' | 'valueUsd'>> = [];
    let reachedFloor = false;
    let lastSeen: string | null = null;

    for (const tx of rows) {
      const hash = tx.txid;
      const at = tx.status?.block_time;
      if (!hash || !at || tx.status?.confirmed === false) continue;
      lastSeen = hash;

      const minedAt = new Date(at * 1000);
      if (until && minedAt < until) {
        reachedFloor = true;
        continue;
      }

      const sats = paidTo(tx, address) - spentFrom(tx, address);
      // Zero net is this address moving its own coins between its own outputs,
      // or appearing in a transaction that did not touch it after fees
      if (sats === 0) continue;
      const direction = sats > 0 ? 'in' : 'out';

      plain.push({
        txHash: hash,
        // One row per transaction: on Bitcoin the address's net IS the transfer
        idx: 0,
        minedAt,
        direction,
        counterparty: otherSide(tx, address, direction),
        network: 'btc',
        operation: direction === 'in' ? 'receive' : 'send',
        symbol: 'BTC',
        assetId: null,
        // The fee is inside this figure for a spend, which is correct: the
        // sender is the one who paid it, and it did leave the address
        amount: Math.abs(sats) / 1e8,
      });
    }

    const prices = await historicalPrices(plain.map((t) => ({ coin: COIN, at: t.minedAt })));
    const transfers: RawTransfer[] = plain.map((t) => {
      const price = priceAt(prices, COIN, t.minedAt);
      return { ...t, priceUsd: price, valueUsd: price === null ? null : t.amount * price };
    });

    // A short page is the end of the history; reaching the floor ends it too
    const next = reachedFloor || rows.length < 25 || !lastSeen ? null : lastSeen;
    logger.debug(`${address}: ${transfers.length} net movements from ${rows.length} transactions`);
    return { transfers, next };
  },
};
