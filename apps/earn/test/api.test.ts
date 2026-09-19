import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { ProblemFilter } from '../src/api/problems';
import { KaminoApi } from '../src/infrastructure/kamino/api';
import { KaminoSource } from '../src/infrastructure/kamino/source';
import { settingsFromEnv } from '../src/settings';
import { RecordedKamino } from './fixtures/kamino';

let app: INestApplication;
let base = '';

const asked = async (path: string): Promise<{ status: number; body: any; type: string }> => {
  const answered = await fetch(`${base}${path}`);
  return {
    status: answered.status,
    type: answered.headers.get('content-type') ?? '',
    body: await answered.json(),
  };
};

before(async () => {
  app = await NestFactory.create(
    AppModule.with({
      settings: { ...settingsFromEnv(), startupGraceMs: 5000, refreshIntervalMs: 600_000 },
      sources: [new KaminoSource(new KaminoApi(new RecordedKamino()))],
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

describe('WhatTheListSays', () => {
  test('a list says when it was read', async () => {
    const { body } = await asked('/v1/lend/pools');
    assert.ok(body.meta.as_of, 'every answer is timestamped');
    assert.equal(body.meta.stale, false);
    assert.equal(body.meta.catalog, 1);
    assert.equal(body.meta.total, body.data.length);
  });

  test('rates and money cross the wire as strings', async () => {
    const { body } = await asked('/v1/lend/pools');
    const first = body.data[0];
    assert.equal(typeof first.apy.net, 'string');
    assert.equal(typeof first.tvl_usd, 'string');
    assert.match(first.apy.net, /^\d+\.\d{6}$/);
    assert.match(first.tvl_usd, /^\d+\.\d{2}$/);
  });

  test('filters are query parameters', async () => {
    const { body } = await asked('/v1/lend/pools?kind=reserve&token=pyusd');
    assert.ok(body.data.length > 0);
    assert.ok(body.data.every((one: any) => one.kind === 'reserve' && one.token.symbol === 'PYUSD'));
  });

  test('paging walks the same list', async () => {
    const first = await asked('/v1/lend/pools?limit=1');
    assert.equal(first.body.data.length, 1);
    assert.ok(first.body.meta.next_cursor);
    const second = await asked(`/v1/lend/pools?limit=1&cursor=${first.body.meta.next_cursor}`);
    assert.notEqual(second.body.data[0].id, first.body.data[0].id);
    assert.equal(second.body.meta.catalog, first.body.meta.catalog);
  });

  test('the detail endpoint carries what signing will need', async () => {
    const list = await asked('/v1/lend/pools?kind=vault');
    const { body } = await asked(`/v1/lend/pools/${list.body.data[0].id}`);
    assert.ok(body.data.deposit.program_id);
    assert.ok(body.data.deposit.address);
    assert.equal(typeof body.data.liquidity.deposited, 'string');
    assert.ok(Array.isArray(body.data.allocations));
  });

  test('tokens answers what can i do with this', async () => {
    const { body } = await asked('/v1/lend/tokens');
    assert.ok(body.data.length > 0);
    const row = body.data[0];
    assert.ok(row.symbol && row.mint && row.best_pool_id);
    assert.match(row.best_apy, /^\d+\.\d{6}$/);
  });
});

describe('WhatAFailureSays', () => {
  test('an unknown pool is a problem document', async () => {
    const { status, body, type } = await asked('/v1/lend/pools/sol:kamino:vault:NOPE');
    assert.equal(status, 404);
    assert.match(type, /application\/problem\+json/);
    assert.equal(body.type, 'https://svinooh.com/problems/not-found');
    assert.equal(body.status, 404);
  });

  test('a malformed cursor says which kind of wrong it is', async () => {
    const { status, body } = await asked('/v1/lend/pools?cursor=not-a-cursor');
    assert.equal(status, 400);
    assert.equal(body.type, 'https://svinooh.com/problems/invalid-cursor');
  });

  test('a cursor from another query is refused', async () => {
    const first = await asked('/v1/lend/pools?limit=1');
    const { status, body } = await asked(
      `/v1/lend/pools?limit=1&token=SOL&cursor=${first.body.meta.next_cursor}`,
    );
    assert.equal(status, 400);
    assert.equal(body.type, 'https://svinooh.com/problems/cursor-query-mismatch');
  });

  test('an unknown filter value is refused before any of our code runs', async () => {
    const { status, body } = await asked('/v1/lend/pools?network=ethereum');
    assert.equal(status, 422);
    assert.equal(body.type, 'https://svinooh.com/problems/invalid-parameter');
    assert.match(body.detail, /network/);
  });

  test('an unknown sort lists what was allowed', async () => {
    const { status, body } = await asked('/v1/lend/pools?sort=whatever');
    assert.equal(status, 422);
    assert.match(body.detail, /-apy/);
  });
});

describe('WhatHealthSays', () => {
  test('health reports the catalog, not just the process', async () => {
    const { status, body } = await asked('/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
    assert.equal(body.catalog, 1);
    assert.ok(body.pools > 0);
    assert.equal(body.stale, false);
    assert.deepEqual(body.degraded, []);
  });
});
