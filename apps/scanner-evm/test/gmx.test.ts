import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import type { ScanPosition } from '@svinooh/shared';
import { gmPool, withEarnings, type GmxNetwork } from '../src/scanners/defi/gmx';

const WETH = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1';
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const ETH_ETH = '0x450bb6774Dd8a756274E0ab4107953259d2ac541';
const ETH_USDC = '0x70d95587d40A2caf56bd97485aB3Eec10Bee6336';

const gmx: GmxNetwork = {
  markets: [
    {
      name: 'ETH/USD [ETH-ETH]',
      marketToken: ETH_ETH,
      longToken: WETH,
      shortToken: WETH,
      poolAmountLong: '3414000000000000000000',
      poolAmountShort: '3414000000000000000000',
    },
    {
      name: 'ETH/USD [WETH-USDC]',
      marketToken: ETH_USDC,
      longToken: WETH,
      shortToken: USDC,
      poolAmountLong: '30000000000000000000000',
      poolAmountShort: '75000000000000',
    },
  ],
  tokens: [
    { symbol: 'ETH', address: WETH, decimals: 18 },
    { symbol: 'USDC', address: USDC, decimals: 6 },
  ],
  tickers: [
    { tokenAddress: WETH, minPrice: '2500000000000000', maxPrice: '2500000000000000' },
    { tokenAddress: USDC, minPrice: '1000000000000000000000000', maxPrice: '1000000000000000000000000' },
  ],
};

const held = (ref: string, valueUsd: number): ScanPosition => ({
  symbol: 'GM: ETH/USD [WETH-WETH]',
  note: null,
  network: 'arb',
  ref: ref.toLowerCase(),
  amount: 11669,
  priceUsd: valueUsd / 11669,
  valueUsd,
  platform: 'wallet',
  category: 'token',
});

test('a GM token held in the wallet is a GMX pool of its one token', () => {
  const pool = gmPool(held(ETH_ETH, 9500), gmx)!;
  assert.equal(pool.symbol, 'GMX V2');
  assert.equal(pool.name, 'Liquidity Pool');
  assert.equal(pool.category, 'defi');
  assert.equal(pool.valueUsd, 9500);
  assert.deepEqual(
    pool.tokens!.map((leg) => [leg.symbol, leg.amount, leg.role]),
    [['ETH', 3.8, 'supply']],
  );
});

test('a two-token market is split the way its pool is', () => {
  const pool = gmPool(held(ETH_USDC, 1000), gmx)!;
  assert.deepEqual(
    pool.tokens!.map((leg) => [leg.symbol, leg.valueUsd]),
    [
      ['ETH', 500],
      ['USDC', 500],
    ],
  );
  assert.equal(pool.tokens![0].amount, 0.2);
});

test('a token that is not a GMX market stays a token', () => {
  assert.equal(gmPool(held('0x0000000000000000000000000000000000000001', 10), gmx), null);
});

test('what GMX says the pool has earned rides on the position, not as a leg', () => {
  const pool = gmPool(held(ETH_ETH, 9500), gmx)!;
  const earned = withEarnings(pool, new Map([[ETH_ETH.toLowerCase(), 412.5]]));
  assert.equal(earned.feesEarnedUsd, 412.5);
  assert.deepEqual(earned.tokens, pool.tokens);
  assert.equal(withEarnings(pool, new Map()).feesEarnedUsd, undefined);
});
