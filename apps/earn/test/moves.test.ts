import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AppModule } from '../src/app.module';
import { ProblemFilter } from '../src/api/problems';
import type { BuiltTransaction } from '../src/application/deposits';
import { MoveNotSupported, NotEnoughHeld, NothingThere } from '../src/application/errors';
import { LendMoves, type ReadPositions } from '../src/application/moves';
import { LendQueries } from '../src/application/queries';
import { CatalogStore } from '../src/application/store';
import { buildCatalog } from '../src/domain/catalog';
import type { Pool } from '../src/domain/pool';
import { idOf } from '../src/domain/values';
import { burnFor, whyNotMove, type Move, type Withdrawal } from '../src/domain/withdrawal';
import { KaminoApi } from '../src/infrastructure/kamino/api';
import { KaminoSource } from '../src/infrastructure/kamino/source';
import { settingsFromEnv } from '../src/settings';
import { RecordedKamino } from './fixtures/kamino';
import { policy, pool } from './support';

const OWNER = '5Hb8BfQVmvEhaKsoXBV2g3EExoqTCKsVNXrGsrbadHJS';

const BUILT: BuiltTransaction = {
  transaction: 'AQAB',
  feePayer: OWNER,
  instructions: 8,
  blockhash: 'HASH',
  lastValidBlockHeight: '400',
};

const PRIME = pool({ address: 'PRIME', name: 'USDC Prime' });
const TURBO = pool({ address: 'TURBO', name: 'Elemental USDC Turbo' });
const JITO = pool({
  address: 'JITO',
  name: 'JitoSOL vault',
  token: { symbol: 'JitoSOL', mint: 'J1to', decimals: 9 },
});

const holding = (pool: Pool, amount: string, shares = amount) => ({
  pool,
  shares: new Decimal(shares),
  amount: new Decimal(amount),
});

const queriesOver = (...pools: Pool[]): LendQueries => {
  const store = new CatalogStore(3);
  store.publish(
    buildCatalog({ version: 1, takenAt: new Date('2026-09-21T12:00:00Z'), pools, policy }),
  );
  return new LendQueries(store);
};

const moving = (held: ReturnType<typeof holding>[]) => {
  const withdrawn: Withdrawal[] = [];
  const moved: Move[] = [];
  const read: ReadPositions = async (_owner, pools) =>
    held.filter((one) => pools.some((p) => idOf(p.id) === idOf(one.pool.id)));
  const lend = new LendMoves(
    queriesOver(PRIME, TURBO, JITO),
    { sol: read },
    { 'sol:kamino': async (withdrawal) => (withdrawn.push(withdrawal), BUILT) },
    { 'sol:kamino': async (move) => (moved.push(move), BUILT) },
  );
  return { lend, withdrawn, moved };
};

const refused = async (build: () => Promise<unknown>): Promise<Error> => {
  try {
    await build();
  } catch (error) {
    return error as Error;
  }
  return new Error('it built something');
};

describe('HowMuchOfAPositionAWithdrawalTakes', () => {
  const twelve = holding(PRIME, '12.001555', '11.59424');

  test('everything is every share, whatever they are worth by now', () => {
    assert.deepEqual(burnFor(twelve, 'all'), { shares: new Decimal('11.59424'), all: true });
  });

  test('the rounded figure the agent was shown is everything, from either side', () => {
    assert.equal((burnFor(twelve, new Decimal('12.0016')) as { all: boolean }).all, true);
    assert.equal((burnFor(twelve, new Decimal('12.00')) as { all: boolean }).all, true);
  });

  test('part of it burns that part of the shares, and never a fraction more', () => {
    const half = burnFor(holding(PRIME, '10', '8'), new Decimal('5'));
    assert.deepEqual(half, { shares: new Decimal('4'), all: false });
    const odd = burnFor(holding(PRIME, '3', '1'), new Decimal('1')) as { shares: Decimal };
    assert.ok(odd.shares.lessThanOrEqualTo(new Decimal('0.333334')));
    assert.ok(odd.shares.decimalPlaces() <= 6, 'rounded to what the shares mint can hold');
  });

  test('more than is there is a shortfall, with what is there', () => {
    const burn = burnFor(twelve, new Decimal('50'));
    assert.ok('short' in burn && burn.held.equals(new Decimal('12.001555')));
  });
});

describe('WhereAMoveCanGo', () => {
  test('between two pools of the same token', () => {
    assert.equal(whyNotMove(PRIME, TURBO), null);
  });

  test('not into the pool it is already in', () => {
    assert.match(whyNotMove(PRIME, PRIME) ?? '', /already in USDC Prime/);
  });

  test('not across tokens, until there is a swap to do it with', () => {
    assert.match(whyNotMove(PRIME, JITO) ?? '', /needs a swap/);
  });
});

describe('TakingMoneyOut', () => {
  test('the builder is told how many shares, and that it is all of them', async () => {
    const { lend, withdrawn } = moving([holding(PRIME, '12.001555', '11.59424')]);
    await lend.withdraw(idOf(PRIME.id), 'all', OWNER);
    assert.equal(withdrawn.length, 1);
    assert.equal(withdrawn[0].pool.name, 'USDC Prime');
    assert.equal(withdrawn[0].owner, OWNER);
    assert.equal(withdrawn[0].all, true);
    assert.ok(withdrawn[0].shares.equals(new Decimal('11.59424')));
  });

  test('a pool the wallet has nothing in is refused by name', async () => {
    const { lend } = moving([holding(PRIME, '12')]);
    const failure = await refused(() => lend.withdraw(idOf(TURBO.id), 'all', OWNER));
    assert.ok(failure instanceof NothingThere);
    assert.match(failure.message, /nothing in Elemental USDC Turbo/);
  });

  test('asking for more than is there says what is there, to the token decimals', async () => {
    const { lend } = moving([holding(PRIME, '12.001555745033967608')]);
    const failure = await refused(() => lend.withdraw(idOf(PRIME.id), new Decimal('50'), OWNER));
    assert.ok(failure instanceof NotEnoughHeld);
    assert.match(failure.message, /has 12\.001555 USDC in USDC Prime/);
  });
});

describe('MovingMoneyBetweenPools', () => {
  test('the builder gets both pools and the shares leaving the first', async () => {
    const { lend, moved } = moving([holding(PRIME, '12.001555', '11.59424')]);
    await lend.move(idOf(PRIME.id), idOf(TURBO.id), 'all', OWNER);
    assert.equal(moved.length, 1);
    assert.deepEqual([moved[0].from.name, moved[0].to.name], ['USDC Prime', 'Elemental USDC Turbo']);
    assert.equal(moved[0].all, true);
  });

  test('a move across tokens is refused before anything is read or built', async () => {
    const { lend, moved } = moving([holding(PRIME, '12')]);
    const failure = await refused(() => lend.move(idOf(PRIME.id), idOf(JITO.id), 'all', OWNER));
    assert.ok(failure instanceof MoveNotSupported);
    assert.deepEqual(moved, []);
  });

  test('a move out of nothing is refused as a withdrawal would be', async () => {
    const { lend } = moving([]);
    assert.ok(
      (await refused(() => lend.move(idOf(PRIME.id), idOf(TURBO.id), 'all', OWNER))) instanceof
        NothingThere,
    );
  });
});

describe('WhatTheWalletHolds', () => {
  test('is what the reader found, among the pools on that network', async () => {
    const { lend } = moving([holding(PRIME, '12.001555', '11.59424')]);
    const { positions } = await lend.positions('sol', OWNER);
    assert.deepEqual(
      positions.map((p) => [p.pool.name, p.amount.toString()]),
      [['USDC Prime', '12.001555']],
    );
  });
});

describe('TheEndpointsForTakingMoneyOut', () => {
  let app: INestApplication;
  let base = '';
  const withdrawn: Withdrawal[] = [];
  const moved: Move[] = [];

  before(async () => {
    app = await NestFactory.create(
      AppModule.with({
        settings: { ...settingsFromEnv(), startupGraceMs: 5000, refreshIntervalMs: 600_000 },
        sources: [new KaminoSource(new KaminoApi(new RecordedKamino()))],
        positions: {
          sol: async (_owner, pools) => pools.slice(0, 1).map((one) => holding(one, '12', '11')),
        },
        withdrawals: { 'sol:kamino': async (withdrawal) => (withdrawn.push(withdrawal), BUILT) },
        moves: { 'sol:kamino': async (move) => (moved.push(move), BUILT) },
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

  test('what an owner holds comes back with each pool and its amount', async () => {
    const { status, body } = await ask('GET', `/v1/lend/positions?network=sol&owner=${OWNER}`);
    assert.equal(status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].amount, '12');
    assert.ok(body.data[0].pool.id.startsWith('sol:kamino:'));
  });

  test('a withdrawal of everything comes back as a transaction', async () => {
    const { body: listed } = await ask('GET', `/v1/lend/positions?network=sol&owner=${OWNER}`);
    const { status, body } = await ask('POST', `/v1/lend/pools/${listed.data[0].pool.id}/withdraw`, {
      amount: 'all',
      owner: OWNER,
    });
    assert.equal(status, 200);
    assert.equal(body.data.transaction, BUILT.transaction);
    assert.equal(withdrawn.at(-1)?.all, true);
  });

  test('a move needs both ends', async () => {
    const { status, body } = await ask('POST', '/v1/lend/moves', { amount: 'all', owner: OWNER });
    assert.equal(status, 422);
    assert.match(body.detail, /from/);
  });

  test('an owner that is not an address is a problem, not a crash', async () => {
    const { status } = await ask('GET', '/v1/lend/positions?network=sol&owner=nobody');
    assert.equal(status, 422);
  });
});
