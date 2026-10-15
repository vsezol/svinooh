import type { PositionHistoryDto, PositionHistoryLegDto, PositionTokenRole } from '@svinooh/shared';
import { fmtUsd } from './format';

export interface PositionLine {
  label: string;
  unit: string;
  role: PositionTokenRole | null;
  values: number[];
}

export interface PositionLines {
  times: number[];
  lines: PositionLine[];
}

export const USD = '$';

const ROLE_ORDER: PositionTokenRole[] = ['supply', 'borrow', 'reward'];

export function positionLines(
  history: PositionHistoryDto,
  position: { pool: boolean; title: string },
): PositionLines {
  const times = history.times.map((t) => new Date(t).getTime());
  return { times, lines: legLines(history, position) };
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

function legLines(history: PositionHistoryDto, { pool, title }: { pool: boolean; title: string }): PositionLine[] {
  const lines = history.legs
    .filter((leg) => leg.amounts.some((amount) => amount !== null))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role))
    .map((leg) => ({
      label: legLabel(leg, pool),
      unit: leg.symbol,
      role: leg.role,
      values: leg.amounts.map((amount) => amount ?? 0),
    }));
  if (lines.length) return lines;
  if (history.amounts.some((amount) => amount !== null)) {
    return [{ label: title, unit: title, role: null, values: carryForward(history.amounts) ?? [] }];
  }
  return [{ label: 'USD', unit: USD, role: null, values: history.usd }];
}

function legLabel(leg: PositionHistoryLegDto, pool: boolean): string {
  if (leg.role === 'borrow') return `${leg.symbol} debt`;
  if (leg.role === 'reward') return `${leg.symbol} ${pool ? 'fees' : 'rewards'}`;
  return leg.symbol;
}

function carryForward(values: Array<number | null>): number[] | null {
  const first = values.find((value) => value !== null);
  if (first == null) return null;
  let last = first;
  return values.map((value) => (last = value ?? last));
}
