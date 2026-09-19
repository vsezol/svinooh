import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AppModule } from '../src/app.module';
import { ProblemFilter } from '../src/api/problems';
import { LendDeposits, type BuildDeposit, type BuiltDeposit } from '../src/application/deposits';
import {
  AmountBelowMinimum,
  DepositNotSupported,
  PoolNotFound,
} from '../src/application/errors';
import { LendQueries } from '../src/application/queries';
import { CatalogStore } from '../src/application/store';
import { buildCatalog } from '../src/domain/catalog';
import { baseUnits, belowMinimum, type Deposit, type Landing } from '../src/domain/deposit';
import type { Pool } from '../src/domain/pool';
import { idOf } from '../src/domain/values';
import { KaminoApi } from '../src/infrastructure/kamino/api';
import { KaminoSource } from '../src/infrastructure/kamino/source';
import { settingsFromEnv } from '../src/settings';
import { RecordedKamino } from './fixtures/kamino';
import { policy, pool } from './support';

const TRANSACTION: BuiltDeposit = {
  transaction: 'AQAB',
  feePayer: 'owner',
  instructions: 3,
  blockhash: 'HASH',
  lastValidBlockHeight: '400',
};

const OWNER = 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL';

const SIGNATURE =
  '5ndCyVRV3mQRLmTdhKbJdFVWEPfYhfqZmAaLvQnqaJ8pZJqvHkBQ7kkbXHbPMRLzrXhDcQAqfHuNvAhVQDWkZqYh';

const PENDING: Landing = { signature: SIGNATURE, status: 'pending', slot: null, error: null };

const catalogOf = (...pools: Pool[]) =>
  buildCatalog({ version: 1, takenAt: new Date('2026-09-10T12:00:00Z'), pools, policy });

const queriesOver = (...pools: Pool[]): LendQueries => {
  const store = new CatalogStore(3);
  store.publish(catalogOf(...pools));
  return new LendQueries(store);
};

const deposits = (builders: Record<string, BuildDeposit>, ...pools: Pool[]) =>
  new LendDeposits(queriesOver(...pools), builders);

const refused = async (build: () => Promise<unknown>): Promise<Error> => {
  try {
    await build();
  } catch (error) {
    return error as Error;
  }
  return new Error('it built something');
};

describe('WhatADepositIsWorth', () => {
  test('an amount reaches the program in the token base units', () => {
    const deposit: Deposit = { pool: pool(), amount: new Decimal('1.5'), owner: OWNER };
    assert.equal(baseUnits(deposit), '1500000');
  });

  test('a token with no decimals in the catalog is counted whole', () => {
    const unknown = pool({ token: { symbol: 'USDC', mint: 'EPjF', decimals: null } });
    assert.equal(baseUnits({ pool: unknown, amount: new Decimal('7'), owner: OWNER }), '7');
  });

  test('more decimals than the token has are dropped, never rounded up', () => {
    const deposit: Deposit = { pool: pool(), amount: new Decimal('1.9999999'), owner: OWNER };
    assert.equal(baseUnits(deposit), '1999999');
  });

  test('a pool with no minimum takes any amount', () => {
    assert.equal(belowMinimum({ pool: pool(), amount: new Decimal('0.01'), owner: OWNER }), false);
  });

  test('a pool with a minimum says so below it and not on it', () => {
    const strict = pool({ deposit: { ...pool().deposit, minAmount: new Decimal('100') } });
    assert.equal(belowMinimum({ pool: strict, amount: new Decimal('99.99'), owner: OWNER }), true);
    assert.equal(belowMinimum({ pool: strict, amount: new Decimal('100'), owner: OWNER }), false);
  });
});

describe('WhichProtocolBuildsADeposit', () => {
  const kamino = pool();
  const meteora = pool({
    id: { network: 'sol', protocol: 'meteora' as 'kamino', kind: 'vault', address: 'MET' },
  });

  test('the pool the catalog does not have is not built', async () => {
    const error = await refused(() =>
      deposits({ 'sol:kamino': async () => TRANSACTION }, kamino).build(
        'sol:kamino:vault:NOPE',
        new Decimal('10'),
        OWNER,
      ),
    );
    assert.ok(error instanceof PoolNotFound, error.message);
  });

  test('a protocol nobody wired yet is named in the refusal', async () => {
    const queries = {
      getPool: () => ({ pool: meteora, catalog: catalogOf() }),
    } as unknown as LendQueries;
    const error = await refused(() =>
      new LendDeposits(queries, { 'sol:kamino': async () => TRANSACTION }).build(
        idOf(meteora.id),
        new Decimal('10'),
        OWNER,
      ),
    );
    assert.ok(error instanceof DepositNotSupported);
    assert.match(error.message, /meteora on sol is not wired/);
  });

  test('below the pool minimum nothing is built at all', async () => {
    let built = 0;
    const strict = pool({ deposit: { ...pool().deposit, minAmount: new Decimal('100') } });
    const error = await refused(() =>
      deposits(
        {
          'sol:kamino': async () => {
            built += 1;
            return TRANSACTION;
          },
        },
        strict,
      ).build(idOf(strict.id), new Decimal('50'), OWNER),
    );
    assert.ok(error instanceof AmountBelowMinimum);
    assert.match(error.message, /takes at least 100 USDC/);
    assert.equal(built, 0);
  });

  test('the builder is handed the pool, the amount and the owner', async () => {
    let seen: Deposit | null = null;
    const answer = await deposits(
      {
        'sol:kamino': async (deposit) => {
          seen = deposit;
          return TRANSACTION;
        },
      },
      kamino,
    ).build(idOf(kamino.id), new Decimal('250'), OWNER);

    assert.equal(seen!.pool.id.address, kamino.id.address);
    assert.equal(seen!.amount.toString(), '250');
    assert.equal(seen!.owner, OWNER);
    assert.equal(answer.built.transaction, TRANSACTION.transaction);
    assert.equal(answer.catalog.version, 1);
  });
});

describe('WhetherADepositLanded', () => {
  const landings = { sol: async (signature: string) => ({ ...PENDING, signature }) };

  test('a chain nobody follows yet is named in the refusal', async () => {
    const error = await refused(() =>
      new LendDeposits(queriesOver(pool()), {}, landings).landing('eth', SIGNATURE),
    );
    assert.ok(error instanceof DepositNotSupported);
    assert.match(error.message, /eth deposits are not followed/);
  });

  test('the chain is asked for the signature it was given', async () => {
    const seen = await new LendDeposits(queriesOver(pool()), {}, landings).landing('sol', SIGNATURE);
    assert.equal(seen.signature, SIGNATURE);
    assert.equal(seen.status, 'pending');
  });
});

describe('TheDepositEndpoint', () => {
  let app: INestApplication;
  let base = '';
  let asked: Deposit | null = null;

  const post = async (path: string, body: unknown) => {
    const answered = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: answered.status, body: (await answered.json()) as any };
  };

  before(async () => {
    app = await NestFactory.create(
      AppModule.with({
        settings: { ...settingsFromEnv(), startupGraceMs: 5000, refreshIntervalMs: 600_000 },
        sources: [new KaminoSource(new KaminoApi(new RecordedKamino()))],
        builders: {
          'sol:kamino': async (deposit) => {
            asked = deposit;
            return TRANSACTION;
          },
        },
        landings: {
          sol: async (signature) => ({ signature, status: 'landed', slot: 42, error: null }),
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

  const anyPool = async (): Promise<string> => {
    const listed = (await fetch(`${base}/v1/lend/pools?limit=1`).then((answered) =>
      answered.json(),
    )) as { data: Array<{ id: string }> };
    return listed.data[0].id;
  };

  test('a transaction comes back beside the catalog it was built from', async () => {
    const id = await anyPool();
    const { status, body } = await post(`/v1/lend/pools/${id}/deposit`, {
      amount: '10',
      owner: OWNER,
    });
    assert.equal(status, 200);
    assert.equal(body.data.transaction, TRANSACTION.transaction);
    assert.equal(body.data.fee_payer, TRANSACTION.feePayer);
    assert.equal(body.data.last_valid_block_height, '400');
    assert.equal(body.meta.catalog, 1);
    assert.equal(asked!.amount.toString(), '10');
  });

  test('an amount that is not a number of tokens is a problem, not a crash', async () => {
    const id = await anyPool();
    const { status, body } = await post(`/v1/lend/pools/${id}/deposit`, {
      amount: 'a lot',
      owner: OWNER,
    });
    assert.equal(status, 422);
    assert.match(body.type, /invalid-parameter$/);
    assert.match(body.detail, /^amount:/);
  });

  test('zero is refused before any protocol is asked', async () => {
    const id = await anyPool();
    const { status, body } = await post(`/v1/lend/pools/${id}/deposit`, {
      amount: '0',
      owner: OWNER,
    });
    assert.equal(status, 422);
    assert.match(body.detail, /greater than 0/);
  });

  test('an owner that is not an account address is refused', async () => {
    const id = await anyPool();
    const { status, body } = await post(`/v1/lend/pools/${id}/deposit`, {
      amount: '10',
      owner: 'me',
    });
    assert.equal(status, 422);
    assert.match(body.detail, /^owner:/);
  });

  test('a landing is answered from the chain, not from the catalog', async () => {
    const answered = await fetch(`${base}/v1/lend/deposits/${SIGNATURE}?network=sol`);
    const body = (await answered.json()) as any;
    assert.equal(answered.status, 200);
    assert.equal(body.data.signature, SIGNATURE);
    assert.equal(body.data.status, 'landed');
    assert.equal(body.data.slot, 42);
    assert.equal(body.meta.catalog, null);
  });

  test('a signature that is not one is refused before the chain is asked', async () => {
    const answered = await fetch(`${base}/v1/lend/deposits/nope?network=sol`);
    const body = (await answered.json()) as any;
    assert.equal(answered.status, 422);
    assert.match(body.detail, /^signature:/);
  });

  test('the chain has to be named', async () => {
    const answered = await fetch(`${base}/v1/lend/deposits/${SIGNATURE}`);
    const body = (await answered.json()) as any;
    assert.equal(answered.status, 422);
    assert.match(body.detail, /^network:/);
  });

  test('a pool the catalog does not have answers 404', async () => {
    const { status, body } = await post('/v1/lend/pools/sol:kamino:vault:NOPE/deposit', {
      amount: '10',
      owner: OWNER,
    });
    assert.equal(status, 404);
    assert.match(body.type, /not-found$/);
  });
});
