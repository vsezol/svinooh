import type { PositionHistoryDto, PositionHistoryLegDto } from '@svinooh/shared';
import { fmtUsd } from './format';

export interface PositionLine {
  label: string;
  unit: string;
  owed: boolean;
  values: number[];
}

export interface PositionLines {
  times: number[];
  lines: PositionLine[];
}

export const USD = '$';

export function positionLines(
  history: PositionHistoryDto,
  position: { pair: string | null; title: string },
): PositionLines {
  const times = history.times.map((t) => new Date(t).getTime());
  const lines = (position.pair ? poolLines(history, position.pair) : null) ?? legLines(history, position.title);
  return { times, lines };
}

export function asChange(values: number[]): number[] {
  const from = values.findIndex((value) => value !== 0);
  if (from < 0) return values.map(() => 0);
  return values.map((value, i) => (i < from ? 0 : (value / values[from] - 1) * 100));
}

export function fmtUnits(unit: string): (value: number) => string {
  if (unit === USD) return (value) => fmtUsd(value);
  return (value) => `${value.toLocaleString('en-US', { maximumSignificantDigits: 6 })} ${unit}`;
}

export const fmtChange = (value: number): string => `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;

function legLines(history: PositionHistoryDto, title: string): PositionLine[] {
  const lines = history.legs
    .filter((leg) => leg.amounts.some((amount) => amount !== null))
    .map((leg) => ({
      label: legLabel(leg),
      unit: leg.symbol,
      owed: leg.role === 'borrow',
      values: leg.amounts.map((amount) => amount ?? 0),
    }));
  if (lines.length) return lines;
  if (history.amounts.some((amount) => amount !== null)) {
    return [{ label: title, unit: title, owed: false, values: carryForward(history.amounts) ?? [] }];
  }
  return [{ label: 'USD', unit: USD, owed: false, values: history.usd }];
}

function legLabel(leg: PositionHistoryLegDto): string {
  if (leg.role === 'borrow') return `${leg.symbol} debt`;
  if (leg.role === 'reward') return `${leg.symbol} rewards`;
  return leg.symbol;
}

function poolLines(history: PositionHistoryDto, pair: string): PositionLine[] | null {
  const worth = poolWorth(history);
  const lines: PositionLine[] = [];
  for (const name of pair.split('/')) {
    const prices = pricesOf(history, name);
    const values = prices && carryForward(worth.map((usd, i) => (prices[i] ? usd / prices[i] : null)));
    if (!values) return null;
    lines.push({ label: `in ${name.trim()}`, unit: name.trim(), owed: false, values });
  }
  return lines.length === 2 ? lines : null;
}

function poolWorth(history: PositionHistoryDto): number[] {
  const held = history.legs.filter((leg) => leg.role !== 'borrow');
  const rewards = held.filter((leg) => leg.role === 'reward');
  const prices = new Map(held.map((leg) => [leg, pricesOf(history, leg.symbol)]));
  const collected = new Map<PositionHistoryLegDto, number>(rewards.map((leg) => [leg, 0]));

  return history.usd.map((usd, i) => {
    let now = 0;
    for (const leg of held) {
      const amount = leg.amounts[i] ?? 0;
      const price = prices.get(leg)?.[i];
      if (amount && !price) return usd;
      now += amount * (price ?? 0);
    }
    let fees = 0;
    for (const leg of rewards) {
      const before = i > 0 ? (leg.amounts[i - 1] ?? 0) : 0;
      const after = leg.amounts[i] ?? 0;
      if (after < before) collected.set(leg, collected.get(leg)! + before - after);
      fees += collected.get(leg)! * (prices.get(leg)?.[i] ?? 0);
    }
    return now + fees;
  });
}

function pricesOf(history: PositionHistoryDto, name: string): Array<number | null> | null {
  const wanted = name.trim().toUpperCase();
  const symbol = Object.keys(history.prices).find((key) => key.toUpperCase() === wanted);
  return symbol ? carryForward(history.prices[symbol]) : null;
}

function carryForward(values: Array<number | null>): number[] | null {
  const first = values.find((value) => value !== null);
  if (first == null) return null;
  let last = first;
  return values.map((value) => (last = value ?? last));
}
