import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { AlertItem, ScanPosition, ScanPositionToken } from '@svinooh/shared';
import { decide, type Remembered } from '../src/alerts/decide';
import { alertableStates, positionKey } from '../src/wallet/sync/wallet-state';

const POSITION = 'Def4KLpb8HGYtQK3zfHricbhiWbCamfVjKB4j1PEejmA';
const BAND = {
  pair: 'SOL/USDC',
  feePct: 0.01,
  chainLabel: 'Solana',
  lower: 113.5296528887166,
  upper: 122.10244701312016,
  current: 120.54,
  priceLabel: 'USDC per SOL',
};

const leg = (symbol: string, valueUsd: number): ScanPositionToken => ({
  symbol,
  amount: null,
  priceUsd: null,
  valueUsd,
  role: 'supply',
});

const meteora = (range: 'in' | 'out', legs: ScanPositionToken[], over: Partial<ScanPosition> = {}) =>
  ({
    symbol: 'Meteora',
    name: 'Liquidity Pool',
    note: 'SOL/USDC',
    valueUsd: legs.reduce((sum, one) => sum + one.valueUsd, 0),
    platform: 'meteora',
    category: 'defi',
    range,
    band: BAND,
    ref: POSITION,
    pool: 'HTvjzsfX3yU6BUodCjZ5vZkUrAxMDTrBs3CJaq43ashR',
    tokens: legs,
    ...over,
  }) as ScanPosition;

const BOTH = [leg('SOL', 269.64), leg('USDC', 1235.19)];
const USDC_ONLY = [leg('USDC', 1504.83)];

const SETTINGS = {
  rangeAlerts: true,
  healthFactorBelow: null,
  borrowApyAbove: null,
  tronReclaimAlerts: false,
  tronDelegateAlerts: false,
};

const alerted = (readings: ScanPosition[][]): Array<AlertItem['direction'][]> => {
  let remembered = new Map<string, Remembered>();
  return readings.map((positions) => {
    const { items, next } = decide(alertableStates(positions), SETTINGS, remembered);
    remembered = new Map([...remembered, ...next]);
    return items.map((item) => item.direction);
  });
};

describe('APositionInABandIsOnePositionWhereverThePriceIs', () => {
  test('it keeps its key as the price walks it from two tokens to one and back', () => {
    assert.equal(positionKey(meteora('in', BOTH)), positionKey(meteora('out', USDC_ONLY)));
  });

  test('named by the source, it keeps its key however its band is written', () => {
    const rounded = { ...BAND, lower: 113.5296529, upper: 122.102447 };
    assert.equal(positionKey(meteora('in', BOTH)), positionKey(meteora('in', BOTH, { band: rounded })));
  });

  test('not named by the source, its band is what it is known by', () => {
    const unnamed = (legs: ScanPositionToken[]) => meteora('in', legs, { ref: null });
    assert.equal(positionKey(unnamed(BOTH)), positionKey(unnamed(USDC_ONLY)));
  });

  test('two positions in one pool are two', () => {
    const other = meteora('in', BOTH, { ref: '99stbBgutZf1DsT6YeYJWpaE2b9gMJuKzwrUwPch1yXu' });
    assert.notEqual(positionKey(meteora('in', BOTH)), positionKey(other));
  });

  test('a loan is still told apart by what it is made of', () => {
    const loan = (legs: ScanPositionToken[]): ScanPosition => ({
      symbol: 'Kamino',
      name: 'Lending',
      valueUsd: 100,
      platform: 'kamino',
      category: 'defi',
      healthRate: 3.2,
      ref: 'obligation',
      tokens: legs,
    });
    assert.notEqual(positionKey(loan([leg('SOL', 1)])), positionKey(loan([leg('SOL', 1), leg('CBBTC', 1)])));
  });

  test('out over the top holding one token, and back in holding two, are both told', () => {
    assert.deepEqual(
      alerted([
        [meteora('in', BOTH)],
        [meteora('out', USDC_ONLY)],
        [meteora('out', USDC_ONLY)],
        [meteora('in', BOTH)],
      ]),
      [[], ['entered'], [], ['recovered']],
    );
  });
});
