import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { ScanPosition, ScanResult } from '@svinooh/shared';
import {
  HELD_MS,
  LandingOverlay,
  overlaid,
  type PairAfterLanding,
  type WalletAfterLanding,
} from '../src/wallet/sync/landing-overlay';

const ADDRESS = '5Hb8BfQVmvEhaKsoXBV2g3EExoqTCKsVNXrGsrbadHJS';
const SOL = '11111111111111111111111111111111';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const POOL = 'BVRbyLjjfSBcoyiYFuxbgKYnWuiFaF9CSXEa5vdSZ9Hh';
const POSITION = '955JzCunqaRHzTkAKXVQ23EoPuwfrSgxVQEXJRXC3kSK';

const coin = (symbol: string, ref: string, amount: number, priceUsd: number): ScanPosition => ({
  symbol,
  amount,
  priceUsd,
  valueUsd: amount * priceUsd,
  platform: 'wallet',
  category: 'token',
  network: 'sol',
  ref,
});

const reading = (positions: ScanPosition[]): ScanResult => {
  const totalUsd = positions.reduce((sum, one) => sum + one.valueUsd, 0);
  return { chain: 'SOL', address: ADDRESS, totalUsd, breakdown: { defi: totalUsd, gmtrade: 0 }, positions };
};

const PAIR: PairAfterLanding = {
  address: POOL,
  x: 'SOL',
  y: 'USDC',
  feePct: 0.2,
  price: 116.968,
  priceXUsd: 117.14,
  priceYUsd: 0.9999,
  positions: [
    {
      address: POSITION,
      amountX: 0.046605273,
      amountY: 6.541655,
      lowerPrice: 110.825218,
      upperPrice: 122.7135139,
      inRange: true,
      feesUsd: 0,
    },
  ],
};

const OPENED: WalletAfterLanding = {
  slot: 200,
  coins: [
    { mint: SOL, symbol: 'SOL', amount: 0.062747282, priceUsd: 117.14 },
    { mint: USDC, symbol: 'USDC', amount: 0.000017, priceUsd: 0.9999 },
  ],
  vaults: [],
  pairs: [PAIR],
};

const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} is not ${expected}`);

describe('WhatTheChainSaidOverWhatTheIndexerSays', () => {
  test('a position the indexer has not seen yet is there, and the coins that paid for it are gone', () => {
    const before = reading([coin('SOL', SOL, 0.153364147, 117), coin('USDC', USDC, 6.312239, 1)]);
    const after = overlaid(before, OPENED);
    assert.deepEqual(
      after.positions.map((one) => [one.symbol, one.note ?? null, one.range ?? null]),
      [
        ['SOL', null, null],
        ['Meteora', 'SOL/USDC', 'in'],
      ],
    );
    const [, placed] = after.positions;
    assert.equal(placed.ref, POSITION);
    assert.equal(placed.pool, POOL);
    assert.deepEqual(placed.band, {
      pair: 'SOL/USDC',
      feePct: 0.2,
      chainLabel: 'Solana',
      lower: 110.825218,
      upper: 122.7135139,
      current: 116.968,
      priceLabel: 'USDC per SOL',
    });
    near(placed.valueUsd, 0.046605273 * 117.14 + 6.541655 * 0.9999);
    near(after.totalUsd, 0.062747282 * 117 + placed.valueUsd);
    near(after.breakdown!.defi, after.totalUsd);
  });

  test('a position the indexer has already seen is not counted twice', () => {
    const indexed: ScanPosition = {
      symbol: 'Meteora',
      name: 'Liquidity Pool',
      note: 'SOL/USDC',
      valueUsd: 12.004,
      platform: 'meteora',
      category: 'defi',
      ref: POSITION,
      pool: POOL,
    };
    const before = reading([coin('SOL', SOL, 0.062747282, 117), indexed]);
    const after = overlaid(before, OPENED);
    assert.equal(after.positions.filter((one) => one.platform === 'meteora').length, 1);
    near(after.totalUsd, 0.062747282 * 117 + after.positions[1].valueUsd);
  });

  test('a position closed is gone however long the indexer takes to notice', () => {
    const indexed: ScanPosition = {
      symbol: 'Meteora',
      valueUsd: 12,
      platform: 'meteora',
      category: 'defi',
      pool: POOL,
      ref: POSITION,
    };
    const closed: WalletAfterLanding = {
      slot: 300,
      coins: [{ mint: USDC, symbol: 'USDC', amount: 6.54, priceUsd: 1 }],
      vaults: [],
      pairs: [{ ...PAIR, positions: [] }],
    };
    const after = overlaid(reading([indexed]), closed);
    assert.deepEqual(after.positions.map((one) => one.symbol), ['USDC']);
    near(after.totalUsd, 6.54);
  });

  test('money out of a vault leaves both the vault and its farm, and sits in the wallet', () => {
    const shares = coin('kV-gtUSDCp', 'SHARES', 1, 1.03);
    const farmed: ScanPosition = { symbol: 'Kamino', valueUsd: 11, platform: 'kamino', category: 'defi', pool: 'FARM' };
    const after = overlaid(reading([shares, farmed]), {
      slot: 100,
      coins: [{ mint: USDC, symbol: 'USDC', amount: 12.00764, priceUsd: 0.9999 }],
      vaults: [
        {
          address: 'VAULT',
          farm: 'FARM',
          sharesMint: 'SHARES',
          name: 'USDC Prime',
          token: 'USDC',
          amount: 0,
          priceUsd: 0.9999,
          apy: 0.049,
        },
      ],
      pairs: [],
    });
    assert.deepEqual(after.positions.map((one) => one.symbol), ['USDC']);
  });

  test('money into a vault is a position of that vault, named and valued', () => {
    const after = overlaid(reading([coin('USDC', USDC, 12, 1)]), {
      slot: 100,
      coins: [{ mint: USDC, symbol: 'USDC', amount: 0, priceUsd: 1 }],
      vaults: [
        {
          address: 'VAULT',
          farm: null,
          sharesMint: null,
          name: 'USDC Prime',
          token: 'USDC',
          amount: 12,
          priceUsd: 1,
          apy: 0.049,
        },
      ],
      pairs: [],
    });
    assert.deepEqual(
      after.positions.map((one) => [one.symbol, one.name, one.note, one.valueUsd, one.apy]),
      [['Kamino', 'Vault', 'USDC Prime', 12, 0.049]],
    );
    near(after.totalUsd, 12);
  });

  test('a coin nobody can price is left as the reading had it', () => {
    const odd = coin('ODD', 'ODD', 5, 2);
    const after = overlaid(reading([odd]), {
      slot: 100,
      coins: [{ mint: 'NEW', symbol: 'NEW', amount: 3, priceUsd: null }],
      vaults: [],
      pairs: [],
    });
    assert.deepEqual(after, reading([odd]));
  });

  test('the price the reading has is the price a coin is valued at', () => {
    const after = overlaid(reading([coin('SOL', SOL, 1, 100)]), {
      slot: 100,
      coins: [{ mint: SOL, symbol: 'SOL', amount: 2, priceUsd: 999 }],
      vaults: [],
      pairs: [],
    });
    near(after.positions[0].valueUsd, 200);
  });
});

describe('HowLongALandingIsBelievedOverTheIndexer', () => {
  const stale = reading([coin('SOL', SOL, 0.153364147, 117), coin('USDC', USDC, 6.312239, 1)]);

  test('until the indexers have had time to catch up, and not after', () => {
    const overlay = new LandingOverlay();
    overlay.hold('w-1', OPENED, 0);
    assert.notDeepEqual(overlay.over('w-1', stale, HELD_MS - 1), stale);
    assert.deepEqual(overlay.over('w-1', stale, HELD_MS), stale);
  });

  test('only for the wallet it landed in', () => {
    const overlay = new LandingOverlay();
    overlay.hold('w-1', OPENED, 0);
    assert.deepEqual(overlay.over('w-2', stale, 1), stale);
  });

  const withdrawn: WalletAfterLanding = {
    slot: 100,
    coins: [
      { mint: USDC, symbol: 'USDC', amount: 12, priceUsd: 1 },
      { mint: 'SHARES', symbol: 'kV-gtUSDCp', amount: 0, priceUsd: 1 },
    ],
    vaults: [],
    pairs: [],
  };

  test('each step of several is kept, and the later step wins where both say something', () => {
    const overlay = new LandingOverlay();
    overlay.hold('w-1', withdrawn, 0);
    overlay.hold('w-1', OPENED, 1000);
    const after = overlay.over('w-1', reading([coin('kV-gtUSDCp', 'SHARES', 12, 1)]), 2000);
    assert.deepEqual(after.positions.map((one) => one.symbol), ['SOL', 'Meteora']);
    assert.notDeepEqual(overlay.over('w-1', reading([]), 1000 + HELD_MS - 1), reading([]));
  });

  test('a step read late does not undo the one that landed after it', () => {
    const overlay = new LandingOverlay();
    overlay.hold('w-1', OPENED, 0);
    overlay.hold('w-1', withdrawn, 1000);
    const after = overlay.over('w-1', reading([]), 2000);
    assert.deepEqual(after.positions.map((one) => one.symbol), ['SOL', 'Meteora']);
  });
});
