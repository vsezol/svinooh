import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AppModule } from '../src/app.module';
import { ProblemFilter } from '../src/api/problems';
import type { BuiltTransaction } from '../src/application/deposits';
import { LendCoins } from '../src/application/coins';
import { CoinNotFound, MoveNotSupported, NotEnoughHeld, NothingThere } from '../src/application/errors';
import { LendMoves, type ReadPositions } from '../src/application/moves';
import { LendQueries } from '../src/application/queries';
import { CatalogStore } from '../src/application/store';
import { buildCatalog } from '../src/domain/catalog';
import type { Pool } from '../src/domain/pool';
import { idOf } from '../src/domain/values';
import { whyNotMove, type Coin, type Move } from '../src/domain/move';
import { burnFor, type Withdrawal } from '../src/domain/withdrawal';
import { KaminoApi } from '../src/infrastructure/kamino/api';
import { KaminoSource } from '../src/infrastructure/kamino/source';
import { settingsFromEnv } from '../src/settings';
import { RecordedKamino } from './fixtures/kamino';
import { policy, pool } from './support';

const OWNER = '5Hb8BfQVmvEhaKsoXBV2g3EExoqTCKsVNXrGsrbadHJS';

const PYUSD = '2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo';

const STEP = { amount: '5.1', payWith: 'USDSwr', receiveAs: 'DezX', holding: 'USDS' };

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

const BONK: Coin = { symbol: 'Bonk', mint: 'DezX', decimals: 5, program: 'Tokenkeg' };

const moving = (held: ReturnType<typeof holding>[], wallet: Record<string, string | null> = {}) => {
  const withdrawn: Withdrawal[] = [];
  const moved: Move[] = [];
  const read: ReadPositions = async (_owner, pools) =>
    held.filter((one) => pools.some((p) => idOf(p.id) === idOf(one.pool.id)));
  const queries = queriesOver(PRIME, TURBO, JITO);
  const coins = new LendCoins(queries, {
    sol: async (query) => (query.toLowerCase() === 'bonk' || query === BONK.mint ? BONK : null),
  });
  const build = async (move: Move) => (moved.push(move), BUILT);
  const lend = new LendMoves(
    queries,
    { sol: read },
    { 'sol:kamino': async (withdrawal) => (withdrawn.push(withdrawal), BUILT) },
    { 'sol:kamino': build, sol: build },
    coins,
    {
      sol: async (_owner, token) => {
        const figure = wallet[token.symbol];
        return figure === undefined ? new Decimal(0) : figure === null ? null : new Decimal(figure);
      },
    },
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
  const USDC: Coin = { symbol: 'USDC', mint: 'EPjF', decimals: 6, program: 'Tokenkeg' };
  const reserve = pool({
    address: 'RES',
    id: { network: 'sol', protocol: 'kamino', kind: 'reserve', address: 'RES' },
  });

  test('between two pools of the same token', () => {
    assert.equal(whyNotMove({ pool: PRIME }, { pool: TURBO }), null);
  });

  test('not into the pool it is already in', () => {
    assert.match(whyNotMove({ pool: PRIME }, { pool: PRIME }) ?? '', /already in USDC Prime/);
  });

  test('across tokens too, now that there is a swap to do it with', () => {
    assert.equal(whyNotMove({ pool: PRIME }, { pool: JITO }), null);
  });

  test('not out of one pool into a lending market\'s reserve: a move goes into a vault', () => {
    assert.match(whyNotMove({ pool: PRIME }, { pool: reserve }) ?? '', /reserve; a move goes into a vault/);
  });

  test('not across networks', () => {
    const elsewhere = pool({ address: 'ETH', id: { network: 'eth', protocol: 'kamino', kind: 'vault', address: 'ETH' } as never });
    assert.match(whyNotMove({ pool: PRIME }, { pool: elsewhere }) ?? '', /different networks/);
  });

  test('out of a pool into the wallet as any coin, its own token included', () => {
    assert.equal(whyNotMove({ pool: PRIME }, { coin: BONK }), null);
    assert.equal(whyNotMove({ pool: PRIME }, { coin: USDC }), null);
  });

  test('from the wallet into a pool of another token, a reserve included', () => {
    assert.equal(whyNotMove({ coin: BONK }, { pool: PRIME }), null);
    assert.equal(whyNotMove({ coin: BONK }, { pool: reserve }), null);
  });

  test('from the wallet into a pool of the same token is a deposit, not a move', () => {
    assert.match(whyNotMove({ coin: USDC }, { pool: PRIME }) ?? '', /that is a deposit/);
  });

  test('one coin for another, and never a coin for itself', () => {
    assert.equal(whyNotMove({ coin: BONK }, { coin: USDC }), null);
    assert.match(whyNotMove({ coin: USDC }, { coin: USDC }) ?? '', /USDC already/);
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
    await lend.move({ pool: idOf(PRIME.id) }, { pool: idOf(TURBO.id) }, 'all', OWNER);
    assert.equal(moved.length, 1);
    const { from, to } = moved[0];
    assert.ok('pool' in from && 'pool' in to);
    assert.deepEqual([from.pool.name, to.pool.name], ['USDC Prime', 'Elemental USDC Turbo']);
    assert.equal(from.all, true);
  });

  test('a move across tokens reaches the builder, which swaps on the way', async () => {
    const { lend, moved } = moving([holding(PRIME, '12')]);
    await lend.move({ pool: idOf(PRIME.id) }, { pool: idOf(JITO.id) }, 'all', OWNER);
    const { from, to } = moved[0];
    assert.ok('pool' in from && 'pool' in to);
    assert.deepEqual([from.pool.token.symbol, to.pool.token.symbol], ['USDC', 'JitoSOL']);
  });

  test('a move into the pool it is already in is still refused', async () => {
    const { lend, moved } = moving([holding(PRIME, '12')]);
    const failure = await refused(() =>
      lend.move({ pool: idOf(PRIME.id) }, { pool: idOf(PRIME.id) }, 'all', OWNER),
    );
    assert.ok(failure instanceof MoveNotSupported);
    assert.deepEqual(moved, []);
  });

  test('a move out of nothing is refused as a withdrawal would be', async () => {
    const { lend } = moving([]);
    assert.ok(
      (await refused(() =>
        lend.move({ pool: idOf(PRIME.id) }, { pool: idOf(TURBO.id) }, 'all', OWNER),
      )) instanceof NothingThere,
    );
  });
});

describe('MovingBetweenPoolsAndTheWallet', () => {
  test('out of a pool into the wallet as another coin is a move that swaps', async () => {
    const { lend, moved, withdrawn } = moving([holding(PRIME, '12', '11')]);
    await lend.move({ pool: idOf(PRIME.id) }, { coin: 'bonk' }, 'all', OWNER);
    assert.equal(withdrawn.length, 0);
    const { from, to } = moved[0];
    assert.ok('pool' in from && 'coin' in to);
    assert.equal(from.pool.name, 'USDC Prime');
    assert.equal(from.all, true);
    assert.deepEqual(to.coin, BONK);
  });

  test('out of a pool into its own token is a withdrawal, built as one', async () => {
    const { lend, moved, withdrawn } = moving([holding(PRIME, '12', '11')]);
    await lend.move({ pool: idOf(PRIME.id) }, { coin: 'usdc' }, new Decimal('5'), OWNER);
    assert.equal(moved.length, 0);
    assert.equal(withdrawn[0].pool.name, 'USDC Prime');
    assert.equal(withdrawn[0].all, false);
  });

  test('a coin from the wallet goes into a pool of another token', async () => {
    const { lend, moved } = moving([], { Bonk: '5000' });
    await lend.move({ coin: 'bonk' }, { pool: idOf(PRIME.id) }, new Decimal('1000'), OWNER);
    const { from, to } = moved[0];
    assert.ok('coin' in from && 'pool' in to);
    assert.equal(from.coin.mint, BONK.mint);
    assert.equal(from.amount.toString(), '1000');
    assert.equal(to.pool.name, 'USDC Prime');
  });

  test('a coin the catalog knows is its own, by ticker or by mint', async () => {
    const { lend, moved } = moving([], { USDC: '20' });
    await lend.move({ coin: 'EPjF' }, { coin: 'bonk' }, new Decimal('3'), OWNER);
    const { from } = moved[0];
    assert.ok('coin' in from);
    assert.deepEqual(from.coin, { symbol: 'USDC', mint: 'EPjF', decimals: 6, program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' });
  });

  test('all of a coin is what the wallet holds, to the places the coin counts in', async () => {
    const { lend, moved } = moving([], { Bonk: '1234.567891' });
    await lend.move({ coin: 'bonk' }, { pool: idOf(PRIME.id) }, 'all', OWNER);
    const { from } = moved[0];
    assert.ok('coin' in from);
    assert.equal(from.amount.toString(), '1234.56789');
  });

  test('the figure a screen rounded up is what the wallet holds, not a refusal', async () => {
    const { lend, moved } = moving([], { Bonk: '999.5' });
    await lend.move({ coin: 'bonk' }, { pool: idOf(PRIME.id) }, new Decimal('1000'), OWNER);
    const { from } = moved[0];
    assert.ok('coin' in from);
    assert.equal(from.amount.toString(), '999.5');
  });

  test('more than the wallet holds is refused with what it holds', async () => {
    const { lend, moved } = moving([], { Bonk: '10' });
    const failure = await refused(() =>
      lend.move({ coin: 'bonk' }, { pool: idOf(PRIME.id) }, new Decimal('50'), OWNER),
    );
    assert.ok(failure instanceof NotEnoughHeld);
    assert.match(failure.message, /holds 10 Bonk/);
    assert.deepEqual(moved, []);
  });

  test('a wallet nobody could read spends the figure asked for, but cannot say what all is', async () => {
    const { lend, moved } = moving([], { Bonk: null });
    await lend.move({ coin: 'bonk' }, { pool: idOf(PRIME.id) }, new Decimal('7'), OWNER);
    const { from } = moved[0];
    assert.ok('coin' in from);
    assert.equal(from.amount.toString(), '7');
    const failure = await refused(() => lend.move({ coin: 'bonk' }, { pool: idOf(PRIME.id) }, 'all', OWNER));
    assert.match(failure.message, /could not be read/);
  });

  test('one coin for another goes to the network\'s swap', async () => {
    const { lend, moved } = moving([], { Bonk: '100' });
    await lend.move({ coin: 'bonk' }, { coin: 'USDC' }, new Decimal('100'), OWNER);
    const { from, to } = moved[0];
    assert.ok('coin' in from && 'coin' in to);
    assert.deepEqual([from.coin.symbol, to.coin.symbol], ['Bonk', 'USDC']);
  });

  test('a coin nobody trades is refused by name', async () => {
    const { lend } = moving([holding(PRIME, '12')]);
    const failure = await refused(() => lend.move({ pool: idOf(PRIME.id) }, { coin: 'NOPE' }, 'all', OWNER));
    assert.ok(failure instanceof CoinNotFound);
    assert.match(failure.message, /no coin called NOPE/);
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
        moves: {
          'sol:kamino': async (move) => (moved.push(move), { ...BUILT, then: STEP }),
          sol: async (move) => (moved.push(move), BUILT),
        },
        coins: { sol: async (query) => (query === 'bonk' ? BONK : null) },
        holdings: { sol: async () => new Decimal('100') },
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

  test('a move says what comes after it when one transaction could not hold it', async () => {
    const { body: listed } = await ask('GET', `/v1/lend/positions?network=sol&owner=${OWNER}`);
    const { status, body } = await ask('POST', '/v1/lend/moves', {
      from: listed.data[0].pool.id,
      to_coin: 'bonk',
      amount: 'all',
      owner: OWNER,
    });
    assert.equal(status, 200);
    assert.deepEqual(body.data.then, {
      amount: '5.1',
      pay_with: 'USDSwr',
      receive_as: 'DezX',
      holding: 'USDS',
    });
    const last = moved.at(-1);
    assert.ok(last && 'pool' in last.from && 'coin' in last.to);
  });

  test('a coin from the wallet, into a pool or for another coin', async () => {
    const { body: listed } = await ask('GET', `/v1/lend/positions?network=sol&owner=${OWNER}`);
    const into = await ask('POST', '/v1/lend/moves', {
      from_coin: 'bonk',
      to: listed.data[0].pool.id,
      amount: '40',
      owner: OWNER,
    });
    assert.equal(into.status, 200);
    const swapped = await ask('POST', '/v1/lend/moves', {
      from_coin: 'bonk',
      to_coin: 'pyusd',
      amount: '40',
      owner: OWNER,
    });
    assert.equal(swapped.status, 200);
    const last = moved.at(-1);
    assert.ok(last && 'coin' in last.from && 'coin' in last.to);
    assert.equal(last.to.coin.mint, PYUSD);
  });

  test('a coin the catalog lists is found by ticker, with its mint, places and program', async () => {
    const { status, body } = await ask('GET', '/v1/lend/coins?network=sol&q=pyusd');
    assert.equal(status, 200);
    assert.equal(body.data.symbol, 'PYUSD');
    assert.equal(body.data.mint, PYUSD);
    assert.equal(body.data.decimals, 6);
    assert.equal(body.data.program, 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', 'the program its pool keeps it with');
  });

  test('what a wallet holds of a coin right now, read from the chain', async () => {
    const { status, body } = await ask('GET', `/v1/lend/holdings?network=sol&q=pyusd&owner=${OWNER}`);
    assert.equal(status, 200);
    assert.equal(body.data.coin.mint, PYUSD);
    assert.equal(body.data.amount, '100');
  });

  test('whose wallet has to be said to read it', async () => {
    const { status, body } = await ask('GET', '/v1/lend/holdings?network=sol&q=pyusd');
    assert.equal(status, 422);
    assert.match(body.detail, /^owner:/);
  });

  test('a coin nobody trades is a 404 that says so', async () => {
    const { status, body } = await ask('GET', `/v1/lend/coins?network=sol&q=NOPE&owner=${OWNER}`);
    assert.equal(status, 404);
    assert.match(body.detail, /no coin called NOPE/);
  });

  test('what is not a ticker or a mint is a problem before anything is looked up', async () => {
    const { status } = await ask('GET', '/v1/lend/coins?network=sol&q=%24%24%24%24%24%24%24%24%24%24%24%24%24%24%24%24%24%24%24%24%24');
    assert.equal(status, 422);
  });

  test('an owner that is not an address is a problem, not a crash', async () => {
    const { status } = await ask('GET', '/v1/lend/positions?network=sol&owner=nobody');
    assert.equal(status, 422);
  });
});
