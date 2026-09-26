import { fetchJson, HttpError } from '../http';
import type { LendingFact, SupplyFact } from '@svinooh/shared';

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
  supplyApy?: number | string;
}

interface Obligation {
  obligationAddress?: string;
  refreshedStats?: {
    userTotalBorrow?: number | string;
    loanToValue?: number | string;
    liquidationLtv?: number | string;
  };
  state?: {
    borrows?: Array<{ borrowReserve?: string; borrowedAmountSf?: number | string } | null>;
    deposits?: Array<{ depositReserve?: string; depositedAmount?: number | string } | null>;
  };
}

interface Reserve {
  token: string;
  borrowApy: number;
  supplyApy: number;
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

function supplyRates(obligation: Obligation, byReserve: Map<string, Reserve>): Record<string, number> {
  const rates: Record<string, number> = {};
  for (const deposit of obligation.state?.deposits ?? []) {
    if (!deposit?.depositReserve || deposit.depositReserve === NULL_PUBKEY) continue;
    if (deposit.depositedAmount !== undefined && Number(deposit.depositedAmount) <= 0) continue;
    const reserve = byReserve.get(deposit.depositReserve);
    if (!reserve || !Number.isFinite(reserve.supplyApy)) continue;
    rates[reserve.token.toUpperCase()] = Math.round(reserve.supplyApy * 100 * 100) / 100;
  }
  return rates;
}

function supplied(obligation: Obligation, market: KaminoMarket, byReserve: Map<string, Reserve>): SupplyFact | null {
  const rates = supplyRates(obligation, byReserve);
  if (!Object.keys(rates).length) return null;
  return {
    id: `kamino:${obligation.obligationAddress ?? market.lendingMarket}:supply`,
    ref: obligation.obligationAddress ?? null,
    pool: market.lendingMarket,
    platform: 'kamino',
    market: marketName(market),
    rates,
  };
}

const marketName = (market: KaminoMarket): string => market.name ?? market.lendingMarket.slice(0, 8);

/**
 * A loan's health and what it costs, per borrowed asset.
 *
 * Health is the ratio of the liquidation threshold to where the loan actually
 * sits: at 1 the position is being liquidated. An obligation with nothing
 * borrowed is skipped — it cannot be liquidated and has no rate to climb.
 */
function parse(obligation: Obligation, market: KaminoMarket, byReserve: Map<string, Reserve>): LendingFact[] {
  const stats = obligation.refreshedStats;
  if (!stats || Number(stats.userTotalBorrow) <= 0) return [];

  const ltv = Number(stats.loanToValue) * 100;
  const liquidationLtv = Number(stats.liquidationLtv) * 100;
  if (!Number.isFinite(ltv) || ltv <= 0 || !Number.isFinite(liquidationLtv)) return [];
  const healthFactor = Math.round((liquidationLtv / ltv) * 100) / 100;

  const supplied = supplyRates(obligation, byReserve);
  const facts: LendingFact[] = [];
  for (const borrow of obligation.state?.borrows ?? []) {
    if (!borrow || !borrow.borrowReserve || borrow.borrowReserve === NULL_PUBKEY) continue;
    if (borrow.borrowedAmountSf !== undefined && Number(borrow.borrowedAmountSf) <= 0) continue;
    const reserve = byReserve.get(borrow.borrowReserve);
    if (!reserve || !Number.isFinite(reserve.borrowApy)) continue;
    facts.push({
      id: `kamino:${obligation.obligationAddress ?? market.lendingMarket}:${borrow.borrowReserve}`,
      ref: obligation.obligationAddress ?? null,
      pool: market.lendingMarket,
      platform: 'kamino',
      market: marketName(market),
      token: reserve.token.toUpperCase(),
      healthFactor,
      borrowRate: Math.round(reserve.borrowApy * 100 * 100) / 100,
      supplyRates: Object.keys(supplied).length ? supplied : null,
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
export async function kaminoLending(
  address: string,
): Promise<{ lending: LendingFact[]; supply: SupplyFact[] }> {
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
        if (!obligations.length) return { lending: [], supply: [] };
        answered.push(market.lendingMarket);
        const metrics = await orEmpty<ReserveMetric>(
          `${KAMINO_API}/kamino-market/${market.lendingMarket}/reserves/metrics`,
        );
        const byReserve = new Map<string, Reserve>(
          metrics.map((m) => [
            m.reserve,
            {
              token: m.liquidityToken ?? '?',
              borrowApy: Number(m.borrowApy),
              supplyApy: Number(m.supplyApy),
            },
          ]),
        );
        return {
          lending: obligations.flatMap((o) => parse(o, market, byReserve)),
          supply: obligations
            .map((o) => supplied(o, market, byReserve))
            .filter((fact): fact is SupplyFact => fact !== null),
        };
      } catch {
        return { lending: [], supply: [] };
      }
    }),
  );

  // Only a full pass may narrow the list: a narrowed pass that found nothing
  // means the loan was repaid, not that the wallet has no other markets, and
  // recording that would leave it looking there forever
  if (narrowed.length === all.length) seenIn.set(address, { at: Date.now(), markets: answered });
  else if (!answered.length) seenIn.delete(address);

  return {
    lending: perMarket.flatMap((market) => market.lending),
    supply: perMarket.flatMap((market) => market.supply),
  };
}
