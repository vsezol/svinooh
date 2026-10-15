import type { PositionHistoryDto, PositionHistoryLegDto, PositionTokenDto } from '@svinooh/shared';
import { round2 } from '../common/util';

export interface PositionReading {
  t: number;
  usd: number;
  amount: number | null;
  tokens: PositionTokenDto[] | null;
}

export function positionSeries(readings: PositionReading[]): Omit<PositionHistoryDto, 'range'> {
  const legs = new Map<string, PositionHistoryLegDto>();

  readings.forEach((reading, i) => {
    for (const token of reading.tokens ?? []) {
      const id = `${token.role}:${token.symbol}`;
      let leg = legs.get(id);
      if (!leg) {
        leg = { symbol: token.symbol, role: token.role, amounts: new Array<number | null>(readings.length).fill(null) };
        legs.set(id, leg);
      }
      if (token.amount != null) leg.amounts[i] = (leg.amounts[i] ?? 0) + Math.abs(token.amount);
    }
  });

  return {
    times: readings.map((reading) => new Date(reading.t).toISOString()),
    usd: readings.map((reading) => round2(reading.usd)),
    amounts: readings.map((reading) => reading.amount),
    legs: [...legs.values()],
  };
}
