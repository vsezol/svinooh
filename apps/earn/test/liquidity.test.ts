import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AppModule } from '../src/app.module';
import { ProblemFilter } from '../src/api/problems';
import type { BuiltTransaction } from '../src/application/deposits';
import {
  DepositNotSupported,
  NotEnoughHeld,
  PoolNotFound,
} from '../src/application/errors';
import { LendLiquidity, type Lending, type LiquidityBuilders } from '../src/application/liquidity';
import {
  balance,
  evenRange,
  pairIdOf,
  pairs,
  spanOf,
  whyNotRange,
  widestEven,
  type Close,
  type PairPool,
  type Provide,
  type Rebalance,
} from '../src/domain/liquidity';
import { KaminoApi } from '../src/infrastructure/kamino/api';
import { KaminoSource } from '../src/infrastructure/kamino/source';
import { settingsFromEnv } from '../src/settings';
import { RecordedKamino } from './fixtures/kamino';

const OWNER = '5Hb8BfQVmvEhaKsoXBV2g3EExoqTCKsVNXrGsrbadHJS';
const POSITION = '8PBf2k9bvDgWTWs8HjrwDXzhGfwsLgM1AHvHYfLPcCp';
const SOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

const pairPool = (over: Partial<PairPool> & { address?: string } = {}): PairPool => ({
  id: { network: 'sol', protocol: 'meteora', kind: 'dlmm', address: over.address ?? 'CgqwPL' },
  name: 'SOL-USDC',
  x: { symbol: 'SOL', mint: SOL, decimals: 9, verified: true },
  y: { symbol: 'USDC', mint: USDC, decimals: 6, verified: true },
  binStep: 80,
  baseFeePct: new Decimal('0.05'),
  tvlUsd: new Decimal('683653'),
  volume24hUsd: new Decimal('892678'),
  fees24hUsd: new Decimal('373.93'),
  price: new Decimal('117.25'),
  url: 'https://app.meteora.ag/dlmm/CgqwPL',
  ...over,
});

const range = (below: string, above: string) => ({
  below: new Decimal(below),
  above: new Decimal(above),
});

const BUILT: BuiltTransaction = {
  transaction: 'AQAB',
  feePayer: OWNER,
  instructions: 7,
  blockhash: 'HASH',
  lastValidBlockHeight: '400',
};

const refused = async (build: () => Promise<unknown>): Promise<Error> => {
  try {
    await build();
  } catch (error) {
    return error as Error;
  }
  return new Error('it built something');
};

describe('WhereARangeSitsAmongABinsPool', () => {
  test('10.3% down and 5.5% up is 22 bins of 0.8% — what the SDK placed on mainnet', () => {
    assert.deepEqual(spanOf(range('0.103', '0.055'), 80), { lower: -14, upper: 7, bins: 22 });
  });

  test('a range too wide for one position says how many bins, and the widest there is', () => {
    const why = whyNotRange(range('0.103', '0.055'), pairPool({ binStep: 4 }));
    assert.match(why ?? '', /407 of SOL-USDC's bins, 0\.04% each/);
    assert.match(why ?? '', /about 1\.36% each way/);
    assert.match(why ?? '', /wider bins/);
  });

  test('one that fits is no refusal', () => {
    assert.equal(whyNotRange(range('0.103', '0.055'), pairPool()), null);
  });

  test('a range reaches down and up by a share of the price, and not all of it down', () => {
    assert.match(whyNotRange(range('-0.1', '0.05'), pairPool()) ?? '', /reaches down/);
    assert.match(whyNotRange(range('1', '0.05'), pairPool()) ?? '', /100% or more/);
    assert.match(whyNotRange(range('0', '0'), pairPool()) ?? '', /some width/);
  });

  test('the widest even range is 34 bins each way', () => {
    assert.equal(widestEven(80).toString(), new Decimal(1.008).pow(34).minus(1).toDecimalPlaces(4, Decimal.ROUND_DOWN).toString());
  });

  test('an even range of a width reaches as many bins down as up', () => {
    const even = evenRange(70, 80);
    assert.deepEqual(spanOf(even, 80).bins <= 70, true);
    assert.equal(spanOf(even, 80).upper, 34);
  });
});

describe('BringingWhatGoesInToTheMixTheRangeTakes', () => {
  const price = new Decimal(100);
  const ratio = new Decimal(50);

  test('all y: the share that belongs above the price is swapped into x', () => {
    const plan = balance(new Decimal(0), new Decimal(150), price, ratio);
    assert.ok(plan.swap === 'y' && plan.amount.equals(100));
  });

  test('all x: the share that belongs below the price is swapped into y', () => {
    const plan = balance(new Decimal(2), new Decimal(0), price, ratio);
    assert.ok(plan.swap === 'x' && plan.amount.toDecimalPlaces(6).equals(new Decimal('0.666667')));
  });

  test('what is already in the mix is not swapped at all', () => {
    assert.deepEqual(balance(new Decimal(1), new Decimal(50), price, ratio), { swap: null });
    assert.deepEqual(balance(new Decimal('1.002'), new Decimal(50), price, ratio), { swap: null }, 'a whisker off is left');
  });

  test('nothing in, nothing to swap', () => {
    assert.deepEqual(balance(new Decimal(0), new Decimal(0), price, ratio), { swap: null });
  });
});

describe('WhichPoolsPairTwoTokens', () => {
  test('either order, by ticker in any case or by mint', () => {
    const pool = pairPool();
    assert.ok(pairs(pool, 'sol', 'USDC'));
    assert.ok(pairs(pool, 'USDC', 'SOL'));
    assert.ok(pairs(pool, USDC, SOL));
    assert.ok(!pairs(pool, 'SOL', 'USDT'));
  });
});

const USDS = 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA';

const PRIME = 'sol:kamino:vault:9E69U4GzWhryRaPe8DYpco6Z9vTZY6gg8w6W2QsBACEj';

const outOf = (paysOut: { symbol: string; mint: string } = { symbol: 'USDC', mint: USDC }) => {
  const taken: Array<{ from: string; take: string; owner: string }> = [];
  const lent: Lending = {
    tokenOf: () => ({ name: 'USDC Prime', token: { ...paysOut, decimals: 6 } }),
    takeOut: async (from, take, owner) => {
      taken.push({ from, take: String(take), owner });
      return { built: BUILT, arrived: new Decimal('11.9989984') };
    },
  };
  return { lent, taken };
};

const lending = (
  over: { pools?: PairPool[]; held?: Record<string, string | null>; lent?: Lending } = {},
) => {
  const provided: Provide[] = [];
  const closed: Close[] = [];
  const rebalanced: Rebalance[] = [];
  const known = over.pools ?? [pairPool()];
  const builders: LiquidityBuilders = {
    provide: async (provide) => (provided.push(provide), BUILT),
    close: async (close) => (closed.push(close), BUILT),
    rebalance: async (rebalance) => (rebalanced.push(rebalance), BUILT),
  };
  const liquidity = new LendLiquidity(
    { sol: async () => known },
    { sol: async (address) => known.find((pool) => pool.id.address === address) ?? null },
    { sol: async () => [] },
    new Decimal('100000'),
    { 'sol:meteora': builders },
    {
      sol: async (_owner, token) => {
        const figure = (over.held ?? { SOL: '1', USDC: '100' })[token.symbol];
        return figure === undefined ? new Decimal(0) : figure === null ? null : new Decimal(figure);
      },
    },
    over.lent ?? null,
  );
  return { liquidity, provided, closed, rebalanced };
};

describe('PoolsWorthOffering', () => {
  test('both tokens verified and money enough in the pool to trade through', async () => {
    const fake = pairPool({ address: 'FAKE', x: { symbol: 'SOL', mint: 'FAKESOL', decimals: 9, verified: false } });
    const thin = pairPool({ address: 'THIN', tvlUsd: new Decimal('900') });
    const { liquidity } = lending({ pools: [pairPool(), fake, thin] });
    const fits = await liquidity.pools('sol', 'SOL', 'USDC');
    assert.deepEqual(fits.map((fit) => fit.pool.id.address), ['CgqwPL']);
    assert.equal(fits[0].bins, null);
  });

  test('with a range, each pool says how many bins it is and why it will not fit', async () => {
    const narrow = pairPool({ address: 'NARROW', binStep: 4 });
    const { liquidity } = lending({ pools: [narrow, pairPool()] });
    const fits = await liquidity.pools('sol', 'SOL', 'USDC', range('0.103', '0.055'));
    assert.deepEqual(fits.map((fit) => [fit.pool.id.address, fit.bins, fit.why === null]), [
      ['NARROW', 407, false],
      ['CgqwPL', 22, true],
    ]);
  });

  test('asked, a pool that holds the range says the dollars near its price', async () => {
    const near: Array<[string, string]> = [];
    const narrow = pairPool({ address: 'NARROW', binStep: 1, yUsd: new Decimal('1') });
    const fitting = pairPool({ yUsd: new Decimal('0.9999') });
    const unpriced = pairPool({ address: 'UNPRICED', yUsd: null });
    const liquidity = new LendLiquidity(
      { sol: async () => [narrow, fitting, unpriced] },
      { sol: async () => null },
      { sol: async () => [] },
      new Decimal('100000'),
      {},
      {},
      null,
      {
        sol: async (address, share) => (near.push([address, share.toString()]), new Decimal('20000')),
      },
    );
    const fits = await liquidity.pools('sol', 'SOL', 'USDC', range('0.01', '0'), new Decimal('0.01'));
    assert.deepEqual(
      fits.map((fit) => [fit.pool.id.address, fit.activeUsd?.toString() ?? null]),
      [
        ['NARROW', null],
        ['CgqwPL', '19998'],
        ['UNPRICED', null],
      ],
    );
    assert.deepEqual(near, [['CgqwPL', '0.01']]);
  });

  test('a pool is found by its id, and an id that is not one is not found', async () => {
    const { liquidity } = lending();
    assert.equal((await liquidity.pool('sol:meteora:dlmm:CgqwPL')).name, 'SOL-USDC');
    assert.ok((await refused(() => liquidity.pool('sol:kamino:vault:CgqwPL'))) instanceof PoolNotFound);
    assert.ok((await refused(() => liquidity.pool('sol:meteora:dlmm:NOPE'))) instanceof PoolNotFound);
  });
});

describe('PlacingLiquidity', () => {
  const id = pairIdOf(pairPool().id);

  test('an amount of one of the pool\'s tokens goes in as that token alone', async () => {
    const { liquidity, provided } = lending();
    await liquidity.provide(id, OWNER, { coin: 'usdc', amount: new Decimal('5') }, range('0.103', '0.055'));
    assert.equal(provided[0].amountX.toString(), '0');
    assert.equal(provided[0].amountY.toString(), '5');
    assert.equal(provided[0].range.below.toString(), '0.103');
  });

  test('all of the SOL keeps back what the position\'s account locks as rent', async () => {
    const { liquidity, provided } = lending({ held: { SOL: '1', USDC: '0' } });
    await liquidity.provide(id, OWNER, { coin: 'SOL', amount: 'all' }, range('0.1', '0.1'));
    assert.equal(provided[0].amountX.toString(), '0.94');
  });

  test('both amounts go in as given, each within what the wallet holds', async () => {
    const { liquidity, provided } = lending();
    await liquidity.provide(
      id,
      OWNER,
      { amountX: new Decimal('0.013224704'), amountY: new Decimal('3.443325') },
      range('0.103', '0.055'),
    );
    assert.equal(provided[0].amountX.toString(), '0.013224704');
    assert.equal(provided[0].amountY.toString(), '3.443325');
  });

  test('a coin the pool does not take is refused by the two it does', async () => {
    const { liquidity, provided } = lending();
    const failure = await refused(() =>
      liquidity.provide(id, OWNER, { coin: 'BONK', amount: new Decimal('5') }, range('0.1', '0.1')),
    );
    assert.ok(failure instanceof DepositNotSupported);
    assert.match(failure.message, /takes SOL and USDC/);
    assert.deepEqual(provided, []);
  });

  test('more than the wallet holds is refused with what it holds', async () => {
    const { liquidity } = lending({ held: { SOL: '1', USDC: '32.869919' } });
    const failure = await refused(() =>
      liquidity.provide(id, OWNER, { coin: 'USDC', amount: new Decimal('5000') }, range('0.1', '0.1')),
    );
    assert.ok(failure instanceof NotEnoughHeld);
    assert.match(failure.message, /holds 32\.869919 USDC/);
  });

  test('a range the pool cannot hold in one position is refused before anything is built', async () => {
    const narrow = pairPool({ address: 'NARROW', binStep: 4 });
    const { liquidity, provided } = lending({ pools: [narrow] });
    const failure = await refused(() =>
      liquidity.provide('sol:meteora:dlmm:NARROW', OWNER, { coin: 'USDC', amount: new Decimal('5') }, range('0.103', '0.055')),
    );
    assert.match(failure.message, /one position holds 70/);
    assert.deepEqual(provided, []);
  });

  test('money in a lending pool comes out first, and what arrived is what is placed after', async () => {
    const { lent, taken } = outOf();
    const { liquidity, provided } = lending({ lent });
    const built = await liquidity.provide(id, OWNER, { from: PRIME, amount: 'all' }, range('0.103', '0.055'));
    assert.deepEqual(taken, [{ from: PRIME, take: 'all', owner: OWNER }]);
    assert.equal(built.transaction, BUILT.transaction);
    assert.deepEqual(built.then, {
      action: 'provide',
      poolId: id,
      amount: '11.998998',
      payWith: USDC,
      belowPct: '10.3',
      abovePct: '5.5',
      holding: 'USDC',
    });
    assert.deepEqual(provided, [], 'the position is built only once the money is in the wallet');
  });

  test('a lending pool paying out a token the pair does not take is refused before anything comes out', async () => {
    const { lent, taken } = outOf({ symbol: 'USDS', mint: USDS });
    const { liquidity } = lending({ lent });
    const failure = await refused(() =>
      liquidity.provide(id, OWNER, { from: PRIME, amount: 'all' }, range('0.1', '0.1')),
    );
    assert.ok(failure instanceof DepositNotSupported);
    assert.match(failure.message, /USDC Prime pays out USDS, and SOL-USDC takes SOL and USDC/);
    assert.deepEqual(taken, []);
  });

  test('closing and rebalancing go to the pool\'s builder with the position and whose it is', async () => {
    const { liquidity, closed, rebalanced } = lending();
    await liquidity.close(id, POSITION, OWNER);
    await liquidity.rebalance(id, POSITION, OWNER, range('0.05', '0.05'));
    assert.deepEqual(closed, [{ position: POSITION, owner: OWNER }]);
    assert.equal(rebalanced[0].position, POSITION);
    assert.equal(rebalanced[0].range?.above.toString(), '0.05');
  });
});

describe('TheLiquidityEndpoints', () => {
  let app: INestApplication;
  let base = '';
  const provided: Provide[] = [];
  const takenOut: string[] = [];
  const pool = pairPool({ yUsd: new Decimal('1') });

  before(async () => {
    app = await NestFactory.create(
      AppModule.with({
        settings: { ...settingsFromEnv(), startupGraceMs: 5000, refreshIntervalMs: 600_000 },
        sources: [new KaminoSource(new KaminoApi(new RecordedKamino()))],
        pairPools: { sol: async () => [pool] },
        near: { sol: async () => new Decimal('3739.3') },
        pairPool: { sol: async (address) => (address === pool.id.address ? pool : null) },
        liquidityPositions: {
          sol: async () => [
            {
              address: POSITION,
              pool,
              lowerPrice: new Decimal('75.04591625936818'),
              upperPrice: new Decimal('136.41652194295295'),
              inRange: true,
              amountX: new Decimal('0.02439626'),
              amountY: new Decimal('9.284387'),
              valueUsd: new Decimal('12.158106'),
              feesUsd: new Decimal('0.001123'),
            },
          ],
        },
        holdings: { sol: async () => new Decimal('100') },
        positions: {
          sol: async (_owner, pools) =>
            pools.map((one) => ({ pool: one, shares: new Decimal('11.5'), amount: new Decimal('12') })),
        },
        takeOuts: {
          'sol:kamino': async (withdrawal) => (
            takenOut.push(withdrawal.pool.id.address),
            { built: BUILT, arrived: new Decimal('11.998998') }
          ),
        },
        liquidity: {
          'sol:meteora': {
            provide: async (provide) => (
              provided.push(provide),
              {
                ...BUILT,
                then: {
                  action: 'provide',
                  poolId: pairIdOf(pool.id),
                  amountX: '0.013224704',
                  amountY: '3.443325',
                  belowPct: '10.3',
                  abovePct: '5.5',
                  holding: 'SOL and USDC',
                },
              }
            ),
            close: async () => BUILT,
            rebalance: async () => BUILT,
          },
        },
      }),
      { logger: false },
    );
    app.useGlobalFilters(new ProblemFilter());
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  after(async () => {
    await app.close();
  });

  const ask = async (method: string, path: string, body?: unknown) => {
    const answered = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: answered.status, body: (await answered.json()) as any };
  };

  test('pools of a pair, with the fee rate and whether a range fits', async () => {
    const { status, body } = await ask(
      'GET',
      '/v1/liquidity/pools?network=sol&pair=USDC-SOL&below_pct=10.3&above_pct=5.5',
    );
    assert.equal(status, 200);
    const [one] = body.data;
    assert.equal(one.id, 'sol:meteora:dlmm:CgqwPL');
    assert.equal(one.bin_step, 80);
    assert.equal(one.range_bins, 22);
    assert.equal(one.range_fits, true);
    assert.equal(one.fee_apr, '0.199639');
    assert.equal(one.x.symbol, 'SOL');
  });

  test('asked, a day of fees on the dollars near the price', async () => {
    const { body } = await ask(
      'GET',
      '/v1/liquidity/pools?network=sol&pair=SOL-USDC&below_pct=1&above_pct=0&active_pct=1',
    );
    const [one] = body.data;
    assert.equal(one.active_usd, '3739.30');
    assert.equal(one.fee_active, '0.100000');
  });

  test('not asked, nothing is read near the price', async () => {
    const { body } = await ask('GET', '/v1/liquidity/pools?network=sol&pair=SOL-USDC');
    assert.equal('active_usd' in body.data[0], false);
  });

  test('a pair that is not two tokens is a problem, not a search', async () => {
    const { status } = await ask('GET', '/v1/liquidity/pools?network=sol&pair=SOL');
    assert.equal(status, 422);
  });

  test('half a range is a problem too', async () => {
    const { status } = await ask('GET', '/v1/liquidity/pools?network=sol&pair=SOL-USDC&below_pct=10');
    assert.equal(status, 422);
  });

  test('what a wallet has placed, with its range and what it holds of each', async () => {
    const { status, body } = await ask('GET', `/v1/liquidity/positions?network=sol&owner=${OWNER}`);
    assert.equal(status, 200);
    assert.equal(body.data[0].address, POSITION);
    assert.equal(body.data[0].lower_price, '75.04591626');
    assert.equal(body.data[0].amount_y, '9.284387');
    assert.equal(body.data[0].in_range, true);
  });

  test('placing liquidity says what comes after the swap it starts with', async () => {
    const { status, body } = await ask('POST', `/v1/liquidity/pools/${pairIdOf(pool.id)}/provide`, {
      owner: OWNER,
      coin: 'USDC',
      amount: '5',
      below_pct: '10.3',
      above_pct: '5.5',
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data.then, {
      action: 'provide',
      pool_id: 'sol:meteora:dlmm:CgqwPL',
      amount_x: '0.013224704',
      amount_y: '3.443325',
      below_pct: '10.3',
      above_pct: '5.5',
      holding: 'SOL and USDC',
    });
    assert.equal(provided.at(-1)?.amountY.toString(), '5');
  });

  test('placing straight out of a lending pool takes the money out first', async () => {
    const lent = 'sol:kamino:vault:CwptesNGAXj8S3aRsFHtUomb5zqAA1tMJBYkQVLJjXmd';
    const { status, body } = await ask('POST', `/v1/liquidity/pools/${pairIdOf(pool.id)}/provide`, {
      owner: OWNER,
      from: lent,
      amount: 'all',
      below_pct: '5',
      above_pct: '5',
    });
    assert.equal(status, 200);
    assert.deepEqual(takenOut, ['CwptesNGAXj8S3aRsFHtUomb5zqAA1tMJBYkQVLJjXmd']);
    assert.deepEqual(body.data.then, {
      action: 'provide',
      pool_id: 'sol:meteora:dlmm:CgqwPL',
      amount: '11.998998',
      pay_with: USDC,
      below_pct: '5',
      above_pct: '5',
      holding: 'USDC',
    });
  });

  test('placing needs a range', async () => {
    const { status, body } = await ask('POST', `/v1/liquidity/pools/${pairIdOf(pool.id)}/provide`, {
      owner: OWNER,
      coin: 'USDC',
      amount: '5',
    });
    assert.equal(status, 422);
    assert.match(body.detail, /below_pct and above_pct/);
  });

  test('closing and rebalancing a position come back as transactions', async () => {
    const closed = await ask(
      'POST',
      `/v1/liquidity/pools/${pairIdOf(pool.id)}/positions/${POSITION}/close`,
      { owner: OWNER },
    );
    assert.equal(closed.status, 200);
    const rebalanced = await ask(
      'POST',
      `/v1/liquidity/pools/${pairIdOf(pool.id)}/positions/${POSITION}/rebalance`,
      { owner: OWNER, below_pct: '5', above_pct: '5' },
    );
    assert.equal(rebalanced.status, 200);
  });

  test('a position that is not an address is a problem', async () => {
    const { status } = await ask(
      'POST',
      `/v1/liquidity/pools/${pairIdOf(pool.id)}/positions/nope/close`,
      { owner: OWNER },
    );
    assert.equal(status, 422);
  });
});
