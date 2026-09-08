import { Logger } from '@nestjs/common';
import { fetchJson } from '../../scanners/http';

const logger = new Logger('HistoricalPrice');

/**
 * What an asset was worth at a moment in the past.
 *
 * Zerion hands this over with every transfer it reports, so only the TRON and
 * BTC readers need it — and they need it a lot: one transfer is one (coin,
 * timestamp) pair, and a page of history is a hundred of them.
 *
 * DefiLlama's batch endpoint is what makes that affordable. It takes a map of
 * coin id to a list of timestamps and answers all of them at once, so a page
 * costs one request rather than a hundred. Coin ids are spelled exactly the way
 * the TRON balance scanner already spells them — `coingecko:tron`,
 * `tron:<contract>` — so the two agree on what an asset IS without a table in
 * between (see scanners/tron.ts).
 *
 * Timestamps are rounded to the hour before being asked for. Llama answers the
 * nearest price it has either way, so asking for 14:03:11 and 14:07:52
 * separately buys nothing and costs two lookups instead of one — and a price to
 * the second is a precision this data does not have anyway.
 */

const API = 'https://coins.llama.fi';
const HOUR = 3_600_000;

/** What one (coin, hour) pair costs to look up, and what it answers */
export interface PriceQuery {
  coin: string;
  at: Date;
}

const hourOf = (at: Date): number => Math.floor(at.getTime() / HOUR) * HOUR;
const keyOf = (coin: string, at: Date): string => `${coin}@${hourOf(at)}`;

interface BatchResponse {
  coins?: Record<string, { prices?: Array<{ timestamp?: number; price?: number }> }>;
}

/**
 * Prices for every pair asked for, keyed so a caller can look one back up with
 * `priceKey`. A pair Llama has no answer for is simply absent — the transfer
 * that wanted it is then stored unpriced, which is the honest outcome and the
 * one the adjusted line knows how to skip.
 */
export async function historicalPrices(queries: PriceQuery[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!queries.length) return out;

  // Collapse to the distinct (coin, hour) pairs — a page of USDT transfers in
  // one hour is one lookup, not forty
  const wanted = new Map<string, Set<number>>();
  for (const q of queries) {
    const set = wanted.get(q.coin) ?? new Set<number>();
    set.add(Math.floor(hourOf(q.at) / 1000));
    wanted.set(q.coin, set);
  }

  // Llama caps a batch by URL length rather than by count, so this goes in
  // chunks of coins; the timestamps of one coin always travel together.
  const coins = [...wanted.keys()];
  const CHUNK = 10;
  for (let i = 0; i < coins.length; i += CHUNK) {
    const body: Record<string, number[]> = {};
    for (const coin of coins.slice(i, i + CHUNK)) body[coin] = [...(wanted.get(coin) ?? [])];
    const url = `${API}/batchHistorical?coins=${encodeURIComponent(JSON.stringify(body))}&searchWidth=4h`;

    try {
      const { coins: answered } = await fetchJson<BatchResponse>(url);
      for (const [coin, entry] of Object.entries(answered ?? {})) {
        for (const point of entry.prices ?? []) {
          if (typeof point.timestamp !== 'number' || typeof point.price !== 'number') continue;
          out.set(`${coin}@${Math.floor(point.timestamp / 3600) * HOUR}`, point.price);
        }
      }
    } catch (error) {
      // A price we could not fetch is a transfer stored unpriced, not a failed
      // ingest: the movement itself is real and worth recording, and the next
      // pass over the same page will fill the price in if Llama comes back.
      logger.warn(`batchHistorical failed for ${coins.slice(i, i + CHUNK).join(',')}: ${String(error)}`);
    }
  }

  return out;
}

/**
 * Where to find a query's answer in the map. Llama answers the nearest price it
 * has, which is rarely the exact hour asked for, so the lookup walks a few
 * hours either side before giving up.
 */
export function priceAt(prices: Map<string, number>, coin: string, at: Date): number | null {
  const exact = prices.get(keyOf(coin, at));
  if (exact !== undefined) return exact;
  const base = hourOf(at);
  for (let step = 1; step <= 4; step++) {
    const before = prices.get(`${coin}@${base - step * HOUR}`);
    if (before !== undefined) return before;
    const after = prices.get(`${coin}@${base + step * HOUR}`);
    if (after !== undefined) return after;
  }
  return null;
}
