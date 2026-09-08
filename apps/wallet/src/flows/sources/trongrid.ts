import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { config } from '../../config';
import { fetchJson } from '../../scanners/http';
import { historicalPrices, priceAt, type PriceQuery } from './historical-price';
import type { FlowSource, RawTransfer, TransferPage } from './source';

const logger = new Logger('TronTransfers');
const API = 'https://api.trongrid.io/v1/accounts';

/**
 * TRON transfers from TronGrid, priced from DefiLlama.
 *
 * Two endpoints, because TronGrid keeps them apart and they answer in different
 * shapes: `/transactions` is every contract the account touched (TRX moves live
 * in there among freezes, votes and delegations), and `/transactions/trc20` is
 * token movement. Both are read and merged.
 *
 * Three things this had to be written around, each found by asking the live API
 * rather than the docs:
 *
 *  - `visible=true` is accepted, echoed back in `links.next`, and NOT applied
 *    to `/transactions`: owner_address and to_address come back hex ("41…").
 *    They are converted here, because everything downstream compares addresses
 *    against the base58 spelling we store.
 *  - `/transactions` is not a transfer list. It carries UnfreezeBalanceV2,
 *    votes, delegations — contracts that move no value at all, and one of which
 *    (a freeze) would otherwise read as the account paying itself.
 *  - `/transactions/trc20` includes `Approval` rows with a value of 2²⁵⁶−1.
 *    Counted as a transfer that is a quarter of a trillion dollars of USDT
 *    leaving a wallet.
 *
 * Prices come from DefiLlama in one batch per page — see historical-price.ts.
 * A transfer nobody could price is stored unpriced rather than at zero.
 */

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/**
 * Hex TRON address ("41" + 20 bytes) to the base58check spelling everything
 * else in the system uses. The twin of base58Decode in the api's detect.ts —
 * same encoding, opposite direction, and here rather than shared because this
 * is the only place that ever receives the hex form.
 */
function hexToBase58(hex: string): string | null {
  const clean = hex.trim().toLowerCase();
  if (!/^41[0-9a-f]{40}$/.test(clean)) return null;
  const body = Buffer.from(clean, 'hex');
  const checksum = createHash('sha256')
    .update(createHash('sha256').update(body).digest())
    .digest()
    .subarray(0, 4);
  const full = Buffer.concat([body, checksum]);

  let n = BigInt('0x' + full.toString('hex'));
  let out = '';
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  // Every leading zero byte is one leading '1' — for a 0x41-prefixed address
  // there are none, but the encoding is not the address's to assume
  for (const byte of full) {
    if (byte !== 0) break;
    out = '1' + out;
  }
  return out;
}

/** Already base58, hex, or nothing we can name */
const asAddress = (raw: string | null | undefined): string | null => {
  const value = (raw ?? '').trim();
  if (!value) return null;
  return value.startsWith('T') ? value : hexToBase58(value);
};

const headers = (): Record<string, string> =>
  config.tronApiKey ? { 'TRON-PRO-API-KEY': config.tronApiKey } : {};

interface TronMeta {
  meta?: { links?: { next?: string | null } };
}

interface TronTx {
  txID?: string;
  block_timestamp?: number;
  ret?: Array<{ contractRet?: string }>;
  raw_data?: {
    contract?: Array<{
      type?: string;
      parameter?: { value?: { amount?: number; owner_address?: string; to_address?: string; asset_name?: string } };
    }>;
  };
}

interface Trc20Row {
  transaction_id?: string;
  block_timestamp?: number;
  from?: string;
  to?: string;
  type?: string;
  value?: string;
  token_info?: { symbol?: string; address?: string; decimals?: number };
}

/** A transfer before it has a price — the shape both endpoints reduce to */
type Unpriced = Omit<RawTransfer, 'priceUsd' | 'valueUsd'> & { coin: string };

/** TRX and TRC10 out of the raw contract list; everything else moved no value */
function fromTransactions(rows: TronTx[], self: string): Unpriced[] {
  const out: Unpriced[] = [];
  for (const tx of rows) {
    if (tx.ret?.[0]?.contractRet && tx.ret[0].contractRet !== 'SUCCESS') continue;
    const hash = tx.txID;
    const at = tx.block_timestamp;
    if (!hash || !at) continue;

    (tx.raw_data?.contract ?? []).forEach((contract, idx) => {
      // TransferContract is TRX; TransferAssetContract is a TRC10 token. A
      // freeze, an unfreeze, a vote and a delegation are not transfers — the
      // TRX never leaves the account, and the balance scanner already counts
      // frozen TRX as held (see scanners/tron.ts).
      if (contract.type !== 'TransferContract' && contract.type !== 'TransferAssetContract') return;
      const value = contract.parameter?.value;
      const amountSun = value?.amount;
      if (typeof amountSun !== 'number' || amountSun <= 0) return;

      const from = asAddress(value?.owner_address);
      const to = asAddress(value?.to_address);
      if (from === null && to === null) return;
      // Neither end is us — TronGrid lists a transaction the account merely
      // triggered; nothing of ours moved
      if (from !== self && to !== self) return;
      const direction = to === self ? 'in' : 'out';

      // TRC10 has no reliable decimals here and no Llama price to look up, so
      // it is recorded with the amount as reported and left unpriced. TRX is
      // sun, always six decimals.
      const isTrx = contract.type === 'TransferContract';
      out.push({
        txHash: hash,
        idx,
        minedAt: new Date(at),
        direction,
        counterparty: direction === 'in' ? from : to,
        network: 'tron',
        operation: direction === 'in' ? 'receive' : 'send',
        symbol: isTrx ? 'TRX' : (value?.asset_name ?? 'TRC10'),
        assetId: null,
        amount: isTrx ? amountSun / 1e6 : amountSun,
        coin: isTrx ? 'coingecko:tron' : '',
      });
    });
  }
  return out;
}

function fromTrc20(rows: Trc20Row[], self: string): Unpriced[] {
  const out: Unpriced[] = [];
  for (const row of rows) {
    // Approval is a permission, not a movement — and its value is 2²⁵⁶−1
    if (row.type && row.type !== 'Transfer') continue;
    const hash = row.transaction_id;
    const at = row.block_timestamp;
    const raw = row.value;
    const contract = row.token_info?.address;
    if (!hash || !at || !raw || !contract) continue;

    const decimals = row.token_info?.decimals ?? 6;
    const amount = Number(raw) / 10 ** decimals;
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const from = asAddress(row.from);
    const to = asAddress(row.to);
    if (from !== self && to !== self) continue;
    const direction = to === self ? 'in' : 'out';

    out.push({
      txHash: hash,
      // TRC20 rows are one movement each and arrive as separate rows of the
      // same transaction; the contract distinguishes them, and offsetting by a
      // large number keeps them from colliding with the raw contract indices
      // of the same hash above
      idx: 100 + out.length,
      minedAt: new Date(at),
      direction,
      counterparty: direction === 'in' ? from : to,
      network: 'tron',
      operation: direction === 'in' ? 'receive' : 'send',
      symbol: row.token_info?.symbol || 'TRC20',
      assetId: contract,
      amount,
      coin: `tron:${contract}`,
    });
  }
  return out;
}

/** Both endpoints' cursors, carried as one string so the caller keeps one */
interface TronCursor {
  txs: string | null;
  trc20: string | null;
}

const parseCursor = (raw: string | null): TronCursor => {
  if (!raw) return { txs: null, trc20: null };
  try {
    return JSON.parse(raw) as TronCursor;
  } catch {
    return { txs: null, trc20: null };
  }
};

async function page<T>(url: string): Promise<{ data: T[]; next: string | null }> {
  const body = await fetchJson<{ data?: T[] } & TronMeta>(url, { headers: headers() });
  return { data: body.data ?? [], next: body.meta?.links?.next ?? null };
}

export const trongridTransfers: FlowSource = {
  name: 'trongrid',

  async read(address, { until, cursor, pageSize }): Promise<TransferPage> {
    const limit = Math.min(Math.max(pageSize, 1), 200);
    const at = parseCursor(cursor);
    const query = [
      `limit=${limit}`,
      'only_confirmed=true',
      'order_by=block_timestamp,desc',
      ...(until ? [`min_timestamp=${until.getTime()}`] : []),
    ].join('&');

    // The first page of a read has no cursor for either endpoint; a later one
    // may have exhausted one of them and still be paging the other
    const [txs, trc20] = await Promise.all([
      cursor && at.txs === null
        ? Promise.resolve({ data: [] as TronTx[], next: null })
        : page<TronTx>(at.txs ?? `${API}/${address}/transactions?${query}`),
      cursor && at.trc20 === null
        ? Promise.resolve({ data: [] as Trc20Row[], next: null })
        : page<Trc20Row>(at.trc20 ?? `${API}/${address}/transactions/trc20?${query}`),
    ]);

    const unpriced = [...fromTransactions(txs.data, address), ...fromTrc20(trc20.data, address)];

    // One batch for the whole page rather than a lookup per transfer
    const queries: PriceQuery[] = unpriced
      .filter((t) => t.coin)
      .map((t) => ({ coin: t.coin, at: t.minedAt }));
    const prices = await historicalPrices(queries);

    const transfers: RawTransfer[] = unpriced.map(({ coin, ...t }) => {
      const price = coin ? priceAt(prices, coin, t.minedAt) : null;
      return { ...t, priceUsd: price, valueUsd: price === null ? null : t.amount * price };
    });

    const next =
      txs.next || trc20.next ? JSON.stringify({ txs: txs.next, trc20: trc20.next }) : null;
    logger.debug(`${address}: ${transfers.length} transfers (${txs.data.length} tx, ${trc20.data.length} trc20)`);
    return { transfers, next };
  },
};
