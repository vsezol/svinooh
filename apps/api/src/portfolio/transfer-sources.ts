import { createHash } from 'node:crypto';
import { Semaphore, sleep } from '@svinooh/common';
import type { Chain } from '@svinooh/shared';
import { config } from '../config';

/**
 * Plain transfers of one address, a page at a time, newest first, each leg
 * priced at the time it moved. Only `send` and `receive` — a swap or a protocol
 * deposit moved no money anywhere. A leg nobody can price is dropped: on TRON
 * and EVM that is the spam and the address-poisoning dust, which is most of them.
 */
export interface Transfer {
  txHash: string;
  /** Which leg of the transaction, named the same way on every re-read */
  leg: string;
  at: Date;
  direction: 'in' | 'out';
  counterparty: string | null;
  network: string | null;
  symbol: string;
  amount: number;
  usd: number;
}

export interface TransferPage {
  /** Only what moved at or after the floor */
  transfers: Transfer[];
  /** Where the next page starts; null — nothing older than the floor is left */
  next: string | null;
}

/** A leg before pricing. `coin` is the DefiLlama id to price it by when `usd` is missing. */
type Leg = Omit<Transfer, 'usd'> & { usd: number | null; coin: string | null };

const TIMEOUT_MS = 20_000;

/** A 429 or a 5xx is waited out twice before giving up */
async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) return (await res.json()) as T;
    if (attempt === 2 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`${new URL(url).host} answered ${res.status}`);
    }
    await sleep(1000 * 2 ** attempt);
  }
}

export async function readPage(
  chain: Chain,
  address: string,
  floor: Date,
  cursor: string | null,
): Promise<TransferPage> {
  const read = chain === 'TRON' ? tron : chain === 'BTC' ? btc : zerion;
  const page = await read(address, floor, cursor);
  return { transfers: await priced(page.legs.filter((leg) => leg.at >= floor)), next: page.next };
}

type LegPage = { legs: Leg[]; next: string | null };

async function priced(legs: Leg[]): Promise<Transfer[]> {
  const unpriced = legs.filter((leg) => leg.usd === null && leg.coin);
  await pricesAt(unpriced.map((leg) => ({ coin: leg.coin!, at: leg.at })));
  return legs
    .map(({ coin, ...leg }) => {
      const price = leg.usd === null && coin ? (priceCache.get(priceKey(coin, leg.at)) ?? null) : null;
      return { ...leg, usd: leg.usd ?? (price === null ? null : leg.amount * price) };
    })
    .filter((leg): leg is Transfer => leg.usd !== null);
}

// --- EVM and SOL: Zerion -----------------------------------------------------

interface ZerionTx {
  attributes?: {
    hash?: string;
    mined_at?: string;
    status?: string;
    transfers?: Array<{
      direction?: string;
      sender?: string | null;
      recipient?: string | null;
      quantity?: { float?: number };
      value?: number | null;
      fungible_info?: {
        symbol?: string | null;
        flags?: { verified?: boolean };
        implementations?: Array<{ chain_id?: string; address?: string | null }>;
      };
    }>;
  };
  relationships?: { chain?: { data?: { id?: string } } };
}

/** Zerion's chain ids that differ from the network slugs the UI kit's badges use */
const NETWORK: Record<string, string> = {
  ethereum: 'eth',
  arbitrum: 'arb',
  optimism: 'op',
  polygon: 'matic',
  'binance-smart-chain': 'bsc',
  avalanche: 'avax',
  'zksync-era': 'era',
  mantle: 'mnt',
  fantom: 'ftm',
  hyperevm: 'hyper',
  unichain: 'uni',
  scroll: 'scrl',
  solana: 'sol',
};

/** ...and the ones that differ from DefiLlama's chain names */
const LLAMA_CHAIN: Record<string, string> = {
  'binance-smart-chain': 'bsc',
  avalanche: 'avax',
  'zksync-era': 'era',
};

/** EVM addresses are compared lowercased; base58 keeps its case */
const spell = (raw: string | null | undefined): string | null => {
  const value = (raw ?? '').trim();
  if (!value) return null;
  return value.startsWith('0x') ? value.toLowerCase() : value;
};

async function zerion(address: string, floor: Date, cursor: string | null): Promise<LegPage> {
  if (!config.zerionApiKey) throw new Error('ZERION_API_KEY is not set');
  // A cursor is the whole next-page URL Zerion built, filters and all
  const url =
    cursor ??
    `https://api.zerion.io/v1/wallets/${address}/transactions/?currency=usd` +
      '&filter[asset_types]=fungible&filter[trash]=only_non_trash' +
      `&filter[operation_types]=send,receive&filter[min_mined_at]=${floor.getTime()}&page[size]=100`;
  const auth = Buffer.from(`${config.zerionApiKey}:`).toString('base64');
  const page = await getJson<{ data?: ZerionTx[]; links?: { next?: string | null } }>(url, {
    authorization: `Basic ${auth}`,
  });

  const legs: Leg[] = [];
  for (const tx of page.data ?? []) {
    const a = tx.attributes ?? {};
    const at = new Date(a.mined_at ?? '');
    if (a.status !== 'confirmed' || !a.hash || Number.isNaN(at.getTime())) continue;
    const chainId = tx.relationships?.chain?.data?.id ?? '';

    (a.transfers ?? []).forEach((t, i) => {
      const amount = t.quantity?.float ?? 0;
      // Unverified tokens are the airdropped spam the trash filter lets through
      if ((t.direction !== 'in' && t.direction !== 'out') || !(amount > 0)) return;
      if (!t.fungible_info?.flags?.verified) return;
      const contract = t.fungible_info.implementations?.find((i) => i.chain_id === chainId)?.address;
      legs.push({
        txHash: a.hash!,
        leg: String(i),
        at,
        direction: t.direction,
        // The transfer's own ends, not the transaction's: a token transfer is
        // sent TO the token contract, and that is not where the money went
        counterparty: spell(t.direction === 'in' ? t.sender : t.recipient),
        network: NETWORK[chainId] ?? (chainId || null),
        symbol: t.fungible_info.symbol || '?',
        amount,
        // Zerion leaves most Solana transfers unpriced, USDC included
        usd: t.value ?? null,
        coin: contract ? `${LLAMA_CHAIN[chainId] ?? chainId}:${contract}` : null,
      });
    });
  }
  return { legs, next: page.links?.next ?? null };
}

// --- TRON: TronGrid ----------------------------------------------------------

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

/** TronGrid's `/transactions` names accounts in hex ("41…") whatever `visible` says */
export function tronHexToBase58(hex: string | undefined): string | null {
  const clean = (hex ?? '').trim().toLowerCase();
  if (!/^41[0-9a-f]{40}$/.test(clean)) return null;
  const body = Buffer.from(clean, 'hex');
  const sha = (data: Buffer) => createHash('sha256').update(data).digest();
  const full = Buffer.concat([body, sha(sha(body)).subarray(0, 4)]);
  let n = BigInt('0x' + full.toString('hex'));
  let out = '';
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  return out;
}

interface TronTx {
  txID?: string;
  block_timestamp?: number;
  ret?: Array<{ contractRet?: string }>;
  raw_data?: {
    contract?: Array<{
      type?: string;
      parameter?: { value?: { amount?: number; owner_address?: string; to_address?: string } };
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

/** Keyless TronGrid is per-second and unforgiving: one call at a time, spaced as tron-resources spaces them */
const trongrid = new Semaphore(1);
const TRONGRID_GAP_MS = 300;

const tronGet = <T>(url: string, headers: Record<string, string>): Promise<T> =>
  trongrid.run(async () => {
    try {
      return await getJson<T>(url, headers);
    } finally {
      await sleep(TRONGRID_GAP_MS);
    }
  });

/** Two endpoints, two cursors, carried as one: each is the next-page URL TronGrid built, null once spent */
async function tron(address: string, floor: Date, cursor: string | null): Promise<LegPage> {
  const api = `https://api.trongrid.io/v1/accounts/${address}`;
  const query = `limit=200&only_confirmed=true&min_timestamp=${floor.getTime()}`;
  const headers: Record<string, string> = config.tronApiKey ? { 'TRON-PRO-API-KEY': config.tronApiKey } : {};
  const at: { txs: string | null; trc20: string | null } = cursor
    ? JSON.parse(cursor)
    : { txs: `${api}/transactions?${query}`, trc20: `${api}/transactions/trc20?${query}` };
  type TronPage<T> = { data?: T[]; meta?: { links?: { next?: string } } };
  const none: TronPage<never> = { data: [] };
  const [txs, trc20] = await Promise.all([
    at.txs ? tronGet<TronPage<TronTx>>(at.txs, headers) : none,
    at.trc20 ? tronGet<TronPage<Trc20Row>>(at.trc20, headers) : none,
  ]);

  const legs: Leg[] = [];
  const push = (hash: string, at: number, from: string | null, to: string | null, rest: Pick<Leg, 'leg' | 'symbol' | 'amount' | 'coin'>) => {
    if (from !== address && to !== address) return;
    const direction = to === address ? 'in' : 'out';
    legs.push({
      txHash: hash,
      at: new Date(at),
      direction,
      counterparty: direction === 'in' ? from : to,
      network: 'tron',
      usd: null,
      ...rest,
    });
  };

  for (const tx of txs.data ?? []) {
    if (tx.ret?.[0]?.contractRet !== 'SUCCESS' || !tx.txID || !tx.block_timestamp) continue;
    // TRX only: freezes, votes and delegations move nothing, and TRC10 is spam
    (tx.raw_data?.contract ?? []).forEach((contract, i) => {
      const value = contract.parameter?.value;
      if (contract.type !== 'TransferContract' || !(value?.amount && value.amount > 0)) return;
      push(tx.txID!, tx.block_timestamp!, tronHexToBase58(value.owner_address), tronHexToBase58(value.to_address), {
        leg: `trx:${i}`,
        symbol: 'TRX',
        amount: value.amount / 1e6,
        coin: 'coingecko:tron',
      });
    });
  }

  for (const row of trc20.data ?? []) {
    // Approval is a permission, not a movement — and its value is 2²⁵⁶−1
    const contract = row.token_info?.address;
    if (row.type !== 'Transfer' || !row.transaction_id || !row.block_timestamp || !contract) continue;
    const amount = Number(row.value) / 10 ** (row.token_info?.decimals ?? 6);
    if (!(amount > 0)) continue;
    // TronGrid gives a TRC20 row no index of its own inside the transaction
    push(row.transaction_id, row.block_timestamp, row.from ?? null, row.to ?? null, {
      leg: `trc20:${contract}:${row.from}:${row.to}:${row.value}`,
      symbol: row.token_info?.symbol || 'TRC20',
      amount,
      coin: `tron:${contract}`,
    });
  }

  const next = { txs: txs.meta?.links?.next ?? null, trc20: trc20.meta?.links?.next ?? null };
  return { legs, next: next.txs || next.trc20 ? JSON.stringify(next) : null };
}

// --- BTC: mempool.space ------------------------------------------------------

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

/**
 * Bitcoin has no transfers, only transactions spending some outputs and making
 * others. What the address did is the net of the two, so one transaction is one
 * leg, and the other side is the biggest address on the far end of it.
 */
async function btc(address: string, floor: Date, cursor: string | null): Promise<LegPage> {
  // 25 confirmed transactions a page, continued from the last txid seen; no time filter
  const path = `/address/${address}/txs/chain${cursor ? `/${cursor}` : ''}`;
  const txs = await getJson<BtcTx[]>(`https://mempool.space/api${path}`).catch(() =>
    getJson<BtcTx[]>(`https://blockstream.info/api${path}`),
  );

  const legs: Leg[] = [];
  for (const tx of txs) {
    if (!tx.txid || !tx.status?.confirmed || !tx.status.block_time) continue;
    const inputs = (tx.vin ?? []).map((i) => i.prevout ?? {});
    const outputs = tx.vout ?? [];
    const sum = (list: Vout[]) =>
      list.reduce((s, o) => s + (o.scriptpubkey_address === address ? (o.value ?? 0) : 0), 0);
    const sats = sum(outputs) - sum(inputs);
    if (sats === 0) continue;
    const direction = sats > 0 ? 'in' : 'out';
    const other = (direction === 'out' ? outputs : inputs)
      .filter((o) => o.scriptpubkey_address && o.scriptpubkey_address !== address)
      .sort((x, y) => (y.value ?? 0) - (x.value ?? 0))[0];
    legs.push({
      txHash: tx.txid,
      leg: 'net',
      at: new Date(tx.status.block_time * 1000),
      direction,
      counterparty: other?.scriptpubkey_address ?? null,
      network: 'btc',
      symbol: 'BTC',
      amount: Math.abs(sats) / 1e8,
      usd: null,
      coin: 'coingecko:bitcoin',
    });
  }

  const last = txs.at(-1);
  const older = txs.length === 25 && last?.txid && (last.status?.block_time ?? 0) * 1000 >= floor.getTime();
  return { legs, next: older ? last.txid! : null };
}

// --- Prices at the time: DefiLlama ------------------------------------------

const HOUR_S = 3600;
const PRICE_CACHE_MAX = 100_000;

/**
 * USD per (coin, hour); null — Llama has no price for it. A past hour's price
 * never changes, so an entry is never refreshed, only evicted oldest-first.
 * Stablecoins go through here like anything else rather than as a constant $1:
 * they depeg, and a fake "USDT" shares the ticker.
 */
export const priceCache = new Map<string, number | null>();

const hourOf = (at: Date): number => Math.floor(at.getTime() / 1000 / HOUR_S) * HOUR_S;
const priceKey = (coin: string, at: Date): string => `${coin}@${hourOf(at)}`;

/** Fills priceCache for whatever it lacks: one request per ten coins. Throws rather than leave everything unpriced. */
export async function pricesAt(wanted: Array<{ coin: string; at: Date }>): Promise<void> {
  const hours = new Map<string, Set<number>>();
  for (const { coin, at } of wanted) {
    if (priceCache.has(priceKey(coin, at))) continue;
    const set = hours.get(coin) ?? new Set<number>();
    set.add(hourOf(at));
    hours.set(coin, set);
  }

  const coins = [...hours.keys()];
  for (let i = 0; i < coins.length; i += 10) {
    const batch = Object.fromEntries(coins.slice(i, i + 10).map((coin) => [coin, [...hours.get(coin)!]]));
    const url = `https://coins.llama.fi/batchHistorical?coins=${encodeURIComponent(JSON.stringify(batch))}&searchWidth=4h`;
    const body = await getJson<{ coins?: Record<string, { prices?: Array<{ timestamp: number; price: number }> }> }>(url);

    for (const [coin, asked] of Object.entries(batch)) {
      const points = body.coins?.[coin]?.prices ?? [];
      for (const hour of asked) {
        // Llama answers the nearest point it has within the search width, not the exact hour
        const nearest = points.reduce<{ timestamp: number; price: number } | null>(
          (best, p) => (!best || Math.abs(p.timestamp - hour) < Math.abs(best.timestamp - hour) ? p : best),
          null,
        );
        // "No price" is only final once Llama has had a day to index the hour
        if (nearest || hour < Date.now() / 1000 - 24 * HOUR_S) priceCache.set(`${coin}@${hour}`, nearest?.price ?? null);
      }
    }
  }

  for (const key of priceCache.keys()) {
    if (priceCache.size <= PRICE_CACHE_MAX) break;
    priceCache.delete(key);
  }
}
