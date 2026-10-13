import type { PositionBand, PositionHistoryDto, PositionHistoryLegDto, PositionTokenDto } from '@svinooh/shared';
import { round2 } from '../common/util';

export interface PositionReading {
  t: number;
  usd: number;
  amount: number | null;
  tokens: PositionTokenDto[] | null;
  band: PositionBand | null;
}

export function positionSeries(readings: PositionReading[]): Omit<PositionHistoryDto, 'range'> {
  const empty = () => new Array<number | null>(readings.length).fill(null);
  const legs = new Map<string, PositionHistoryLegDto>();
  const prices: Record<string, Array<number | null>> = {};

  readings.forEach((reading, i) => {
    for (const token of reading.tokens ?? []) {
      const id = `${token.role}:${token.symbol}`;
      let leg = legs.get(id);
      if (!leg) {
        leg = { symbol: token.symbol, role: token.role, amounts: empty() };
        legs.set(id, leg);
      }
      if (token.amount != null) leg.amounts[i] = (leg.amounts[i] ?? 0) + Math.abs(token.amount);
    }
    for (const [symbol, price] of pricesAt(reading)) {
      prices[symbol] ??= empty();
      prices[symbol][i] = price;
    }
  });

  return {
    times: readings.map((reading) => new Date(reading.t).toISOString()),
    usd: readings.map((reading) => round2(reading.usd)),
    amounts: readings.map((reading) => reading.amount),
    legs: [...legs.values()],
    prices,
  };
}

function pricesAt(reading: PositionReading): Map<string, number> {
  const prices = new Map<string, number>();
  for (const token of reading.tokens ?? []) {
    if (token.priceUsd) prices.set(token.symbol, token.priceUsd);
  }

  const band = reading.band;
  if (!band || !(band.current > 0)) return prices;
  const [base, quote] = band.pair.split('/').map((name) => symbolIn(prices, name));
  if (!base || !quote) return prices;
  const basePrice = prices.get(base);
  const quotePrice = prices.get(quote);
  if (basePrice && !quotePrice) prices.set(quote, basePrice / band.current);
  if (quotePrice && !basePrice) prices.set(base, quotePrice * band.current);
  return prices;
}

function symbolIn(prices: Map<string, number>, name: string | undefined): string | null {
  if (!name) return null;
  const wanted = name.trim().toUpperCase();
  return [...prices.keys()].find((symbol) => symbol.toUpperCase() === wanted) ?? name.trim();
}
