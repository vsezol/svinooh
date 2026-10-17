import type { PositionTokenDto } from '@svinooh/shared';

const DAY_MS = 86_400_000;
const MIN_DAYS = 1;
const FLOW = 0.005;
const STABLE_WITHOUT_USD = new Set(['DAI', 'SDAI', 'XDAI', 'GHO', 'FRAX', 'MIM', 'BOLD']);

export interface YieldReading {
  at: Date;
  valueUsd: number;
  amount: number | null;
  priceUsd: number | null;
  tokens: PositionTokenDto[] | null;
  feesEarnedUsd: number | null;
}

export type LegUnit = 'token' | 'usd' | 'unknown';

export interface LegState {
  start: number;
  last: number;
  startPriceUsd: number;
  priceUsd: number;
  owed: boolean;
  unit: LegUnit;
}

export interface YieldState {
  since: string;
  legs: Record<string, LegState>;
  rewardsUsd: number;
  rewards: Record<string, number>;
  earned: { since: string; startUsd: number; nowUsd: number } | null;
}

export interface Realized {
  since: Date;
  apy: number | null;
  rewardsApy: number | null;
}

export function isStablecoin(symbol: string): boolean {
  let name = symbol.trim().toUpperCase().replace('₮', 'T').replace(/\./g, '');
  const principal = /^PT-([^-]+)/.exec(name);
  if (principal) name = principal[1];
  return /^[A-Z0-9]+$/.test(name) && (name.includes('USD') || STABLE_WITHOUT_USD.has(name));
}

export function advance(state: YieldState | null, reading: YieldReading, symbol: string): YieldState {
  const legs = measuredLegs(reading, symbol);
  const rewards = rewardAmounts(reading);
  const rewardsNow = Object.fromEntries([...rewards].map(([id, reward]) => [id, reward.quantity]));
  if (!state) {
    return {
      since: reading.at.toISOString(),
      legs: Object.fromEntries(
        [...legs].map(([id, leg]) => [
          id,
          {
            start: leg.quantity,
            last: leg.quantity,
            startPriceUsd: leg.priceUsd,
            priceUsd: leg.priceUsd,
            owed: leg.owed,
            unit: leg.unit,
          },
        ]),
      ),
      rewardsUsd: 0,
      rewards: rewardsNow,
      earned: earnedFrom(null, reading),
    };
  }

  let rewardsUsd = state.rewardsUsd;
  for (const [id, reward] of rewards) {
    const grown = reward.quantity - (state.rewards[id] ?? 0);
    if (grown > 0) rewardsUsd += grown * reward.priceUsd;
  }

  const ids = [...new Set([...Object.keys(state.legs), ...legs.keys()])];
  const priceOf = (id: string) => legs.get(id)?.priceUsd ?? state.legs[id].priceUsd;
  const sign = (id: string) => ((legs.get(id)?.owed ?? state.legs[id].owed) ? -1 : 1);
  let moved = 0;
  let held = 0;
  for (const id of ids) {
    const last = state.legs[id]?.last ?? 0;
    moved += sign(id) * ((legs.get(id)?.quantity ?? 0) - last) * priceOf(id);
    held += last * priceOf(id);
  }
  const flowed = Math.abs(moved) > FLOW * Math.max(held, Number.EPSILON);

  const next: Record<string, LegState> = {};
  for (const id of ids) {
    const before = state.legs[id];
    const now = legs.get(id);
    const last = before?.last ?? 0;
    const quantity = now?.quantity ?? 0;
    next[id] = {
      start: (before?.start ?? 0) + (flowed ? quantity - last : 0),
      last: quantity,
      startPriceUsd: before?.startPriceUsd ?? now!.priceUsd,
      priceUsd: priceOf(id),
      owed: before?.owed ?? now!.owed,
      unit: before?.unit ?? now!.unit,
    };
  }

  return { ...state, legs: next, rewardsUsd, rewards: rewardsNow, earned: earnedFrom(state.earned, reading) };
}

export function realized(state: YieldState, at: Date): Realized | null {
  const since = new Date(state.since);
  const days = (at.getTime() - since.getTime()) / DAY_MS;
  if (days < MIN_DAYS) return null;
  const legs = Object.values(state.legs);
  if (legs.some((leg) => leg.unit === 'unknown')) return { since, apy: null, rewardsApy: null };

  let body = 0;
  let base = 0;
  for (const leg of legs) {
    const sign = leg.owed ? -1 : 1;
    body += sign * (leg.last - leg.start) * leg.startPriceUsd;
    base += sign * leg.start * leg.startPriceUsd;
  }
  if (base <= 0) return { since, apy: null, rewardsApy: null };
  const yearly = (gain: number, over: number) => (gain / base) * (365 / over);

  const earned = state.earned;
  const earnedDays = earned ? (at.getTime() - Date.parse(earned.since)) / DAY_MS : 0;
  const rewardsApy = earned
    ? earnedDays >= MIN_DAYS
      ? yearly(earned.nowUsd - earned.startUsd, earnedDays)
      : null
    : Object.keys(state.rewards).length || state.rewardsUsd
      ? yearly(state.rewardsUsd, days)
      : null;
  return { since, apy: yearly(body + state.rewardsUsd, days), rewardsApy };
}

interface Measured {
  quantity: number;
  priceUsd: number;
  owed: boolean;
  unit: LegUnit;
}

function measuredLegs(reading: YieldReading, symbol: string): Map<string, Measured> {
  const legs: PositionTokenDto[] = reading.tokens?.length
    ? reading.tokens.filter((t) => t.role !== 'reward')
    : [{ symbol, amount: reading.amount, priceUsd: reading.priceUsd, valueUsd: reading.valueUsd, role: 'supply' }];
  const out = new Map<string, Measured>();
  for (const leg of legs) {
    const id = `${leg.role}:${leg.symbol}`;
    const measured = measure(leg);
    const twin = out.get(id);
    out.set(id, twin ? { ...measured, quantity: twin.quantity + measured.quantity } : measured);
  }
  return out;
}

function rewardAmounts(reading: YieldReading): Map<string, Measured> {
  const out = new Map<string, Measured>();
  for (const leg of reading.tokens ?? []) {
    if (leg.role !== 'reward') continue;
    const measured = measure(leg);
    const twin = out.get(leg.symbol);
    out.set(leg.symbol, twin ? { ...measured, quantity: twin.quantity + measured.quantity } : measured);
  }
  return out;
}

function measure(leg: PositionTokenDto): Measured {
  const owed = leg.role === 'borrow';
  const usd = Math.abs(leg.valueUsd);
  const amount = leg.amount == null ? null : Math.abs(leg.amount);
  if (isStablecoin(leg.symbol)) return { quantity: usd, priceUsd: 1, owed, unit: 'usd' };
  if (amount == null) return { quantity: usd, priceUsd: 1, owed, unit: 'unknown' };
  return { quantity: amount, priceUsd: leg.priceUsd ?? (amount ? usd / amount : 0), owed, unit: 'token' };
}

function earnedFrom(earned: YieldState['earned'], reading: YieldReading): YieldState['earned'] {
  if (reading.feesEarnedUsd == null) return earned;
  const usd = reading.feesEarnedUsd;
  if (!earned) return { since: reading.at.toISOString(), startUsd: usd, nowUsd: usd };
  return { ...earned, nowUsd: usd };
}
