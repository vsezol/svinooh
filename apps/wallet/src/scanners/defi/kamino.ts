import { fetchJson, HttpError } from '../http';
import type { LendingFact } from './types';

const KAMINO_API = 'https://api.kamino.finance';
const NULL_PUBKEY = '11111111111111111111111111111111';
/** Markets change rarely and the list is the same for everybody — fetched once an hour, not per wallet */
const MARKETS_TTL_MS = 60 * 60 * 1000;

interface KaminoMarket {
  lendingMarket: string;
  name?: string;
}

interface ReserveMetric {
  reserve: string;
  liquidityToken?: string;
  borrowApy?: number | string;
}

interface Obligation {
  refreshedStats?: {
    userTotalBorrow?: number | string;
    loanToValue?: number | string;
    liquidationLtv?: number | string;
  };
  state?: { borrows?: Array<{ borrowReserve?: string; borrowedAmountSf?: number | string } | null> };
}

let markets: { at: number; list: KaminoMarket[] } | null = null;

/**
 * Which markets a wallet was last found in.
 *
 * There are 38 of them and asking each one costs two requests, so asking them
 * all on every sync is 76 calls for a wallet that borrows from one. The first
 * look is the expensive one; after that only the markets that answered are
 * asked again. Held in memory on purpose — losing it on a restart costs one
 * expensive scan, and there is nothing here worth a table.
 */
const seenIn = new Map<string, { at: number; markets: string[] }>();
const SEEN_TTL_MS = 6 * 60 * 60 * 1000;

async function marketList(): Promise<KaminoMarket[]> {
  if (markets && Date.now() - markets.at < MARKETS_TTL_MS) return markets.list;
  const list = await fetchJson<KaminoMarket[]>(`${KAMINO_API}/v2/kamino-market`);
  markets = { at: Date.now(), list };
  return list;
}

/** 404 is an answer — this wallet has nothing here — and not a reason to fail the source */
async function orEmpty<T>(url: string): Promise<T[]> {
  try {
    return await fetchJson<T[]>(url);
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) return [];
    throw error;
  }
}

/**
 * A loan's health and what it costs, per borrowed asset.
 *
 * Health is the ratio of the liquidation threshold to where the loan actually
 * sits: at 1 the position is being liquidated. An obligation with nothing
 * borrowed is skipped — it cannot be liquidated and has no rate to climb.
 */
function parse(obligation: Obligation, market: string, apyByReserve: Map<string, { token: string; apy: number }>): LendingFact[] {
  const stats = obligation.refreshedStats;
  if (!stats || Number(stats.userTotalBorrow) <= 0) return [];

  const ltv = Number(stats.loanToValue) * 100;
  const liquidationLtv = Number(stats.liquidationLtv) * 100;
  if (!Number.isFinite(ltv) || ltv <= 0 || !Number.isFinite(liquidationLtv)) return [];
  const healthFactor = Math.round((liquidationLtv / ltv) * 100) / 100;

  const facts: LendingFact[] = [];
  for (const borrow of obligation.state?.borrows ?? []) {
    if (!borrow || !borrow.borrowReserve || borrow.borrowReserve === NULL_PUBKEY) continue;
    if (borrow.borrowedAmountSf !== undefined && Number(borrow.borrowedAmountSf) <= 0) continue;
    const meta = apyByReserve.get(borrow.borrowReserve);
    if (!meta || !Number.isFinite(meta.apy)) continue;
    facts.push({
      id: `kamino:${market}:${borrow.borrowReserve}`,
      platform: 'kamino',
      market,
      token: meta.token.toUpperCase(),
      healthFactor,
      borrowRate: Math.round(meta.apy * 100 * 100) / 100,
    });
  }
  return facts;
}

/**
 * Every Kamino market, asked whether this wallet owes it anything.
 *
 * A market that fails is skipped rather than failing the scan: the markets are
 * independent, and one of a dozen being unreachable should not cost us the
 * other eleven. The source as a whole only fails if the market list itself
 * cannot be had, which is the case where we genuinely know nothing.
 */
export async function kaminoLending(address: string): Promise<LendingFact[]> {
  const all = await marketList();
  const remembered = seenIn.get(address);
  const narrowed =
    remembered && Date.now() - remembered.at < SEEN_TTL_MS
      ? all.filter((m) => remembered.markets.includes(m.lendingMarket))
      : all;

  const answered: string[] = [];
  const perMarket = await Promise.all(
    narrowed.map(async (market) => {
      try {
        // Asked one at a time on purpose: the rates of a market this wallet has
        // never touched are of no interest, and fetching them alongside would
        // double the cost of the pass that looks everywhere
        const obligations = await orEmpty<Obligation>(
          `${KAMINO_API}/kamino-market/${market.lendingMarket}/users/${address}/obligations`,
        );
        if (!obligations.length) return [];
        answered.push(market.lendingMarket);
        const metrics = await orEmpty<ReserveMetric>(
          `${KAMINO_API}/kamino-market/${market.lendingMarket}/reserves/metrics`,
        );
        const apyByReserve = new Map(
          metrics.map((m) => [m.reserve, { token: m.liquidityToken ?? '?', apy: Number(m.borrowApy) }]),
        );
        const name = market.name ?? market.lendingMarket.slice(0, 8);
        return obligations.flatMap((o) => parse(o, name, apyByReserve));
      } catch {
        return [];
      }
    }),
  );

  // Only a full pass may narrow the list: a narrowed pass that found nothing
  // means the loan was repaid, not that the wallet has no other markets, and
  // recording that would leave it looking there forever
  if (narrowed.length === all.length) seenIn.set(address, { at: Date.now(), markets: answered });
  else if (!answered.length) seenIn.delete(address);

  return perMarket.flat();
}
