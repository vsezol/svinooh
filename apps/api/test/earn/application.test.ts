import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { Decimal } from 'decimal.js';
import { CatalogVersionGone, PoolNotFound, SelectionMismatch, CatalogNotReady } from '../../src/earn/application/errors';
import { LendQueries } from '../../src/earn/application/queries';
import { CatalogRefresher } from '../../src/earn/application/refresher';
import { CatalogStore } from '../../src/earn/application/store';
import { buildCatalog } from '../../src/earn/domain/catalog';
import { DEFAULT_SORT, NO_FILTER } from '../../src/earn/domain/selection';
import { idOf } from '../../src/earn/domain/values';
import { policy, pool } from './support';

const clock = () => new Date('2026-09-10T12:00:00Z');

const timersRunning = (): number =>
  process.getActiveResourcesInfo().filter((held) => held === 'Timeout').length;

const withPools = (count: number, version = 1) =>
  buildCatalog({
    version,
    takenAt: clock(),
    pools: Array.from({ length: count }, (_, i) =>
      pool({ address: `P${String(i).padStart(2, '0')}`, apy: { base: new Decimal(`0.0${count - i}`), rewards: new Decimal(0), incentives: new Decimal(0) } }),
    ),
    policy,
  });

const storeWith = (...catalogs: ReturnType<typeof withPools>[]) => {
  const store = new CatalogStore(3);
  catalogs.forEach((catalog) => store.publish(catalog));
  return store;
};

describe('AnsweringFromACatalog', () => {
  test('paging visits every pool exactly once', () => {
    const queries = new LendQueries(storeWith(withPools(5)));
    const selection = { filter: NO_FILTER, sort: DEFAULT_SORT };
    const seen: string[] = [];
    let resume = null as null | { catalogVersion: number; offset: number; fingerprint: string };
    for (let guard = 0; guard < 10; guard++) {
      const answer = queries.listPools(selection, 2, resume);
      seen.push(...answer.page.items.map((one) => idOf(one.id)));
      if (answer.resume === null) break;
      resume = answer.resume;
    }
    assert.equal(seen.length, 5);
    assert.equal(new Set(seen).size, 5);
  });

  test('page size may change mid read', () => {
    const queries = new LendQueries(storeWith(withPools(5)));
    const selection = { filter: NO_FILTER, sort: DEFAULT_SORT };
    const first = queries.listPools(selection, 2);
    const second = queries.listPools(selection, 3, first.resume);
    assert.equal(second.page.items.length, 3);
  });

  test('a cursor from another query is refused', () => {
    const queries = new LendQueries(storeWith(withPools(5)));
    const first = queries.listPools({ filter: NO_FILTER, sort: DEFAULT_SORT }, 2);
    assert.throws(
      () => queries.listPools({ filter: { ...NO_FILTER, token: 'SOL' }, sort: DEFAULT_SORT }, 2, first.resume),
      SelectionMismatch,
    );
  });

  test('a cursor into a forgotten catalog says so', () => {
    const store = storeWith(withPools(5, 1));
    const queries = new LendQueries(store);
    const first = queries.listPools({ filter: NO_FILTER, sort: DEFAULT_SORT }, 2);
    for (const version of [2, 3, 4]) store.publish(withPools(5, version));
    assert.throws(
      () => queries.listPools({ filter: NO_FILTER, sort: DEFAULT_SORT }, 2, first.resume),
      CatalogVersionGone,
    );
  });

  test('a page is read from the catalog the cursor names', () => {
    const store = storeWith(withPools(5, 1));
    const queries = new LendQueries(store);
    const first = queries.listPools({ filter: NO_FILTER, sort: DEFAULT_SORT }, 2);
    store.publish(withPools(5, 2));
    const second = queries.listPools({ filter: NO_FILTER, sort: DEFAULT_SORT }, 2, first.resume);
    assert.equal(second.catalog.version, 1);
  });

  test('an unknown pool is a named failure', () => {
    const queries = new LendQueries(storeWith(withPools(1)));
    assert.throws(() => queries.getPool('sol:kamino:vault:NOPE'), PoolNotFound);
    assert.throws(() => queries.getPool('nonsense'), PoolNotFound);
  });

  test('nothing published yet is not the same as nothing to earn on', () => {
    const queries = new LendQueries(new CatalogStore(3));
    assert.throws(() => queries.listPools({ filter: NO_FILTER, sort: DEFAULT_SORT }, 2), CatalogNotReady);
  });

  test('tokens can be narrowed like pools', () => {
    const catalog = buildCatalog({
      version: 1,
      takenAt: clock(),
      pools: [
        pool({ address: 'U', token: { symbol: 'USDC', mint: 'EPjF', decimals: 6 } }),
        pool({ address: 'S', token: { symbol: 'SOL', mint: 'So111', decimals: 9 } }),
      ],
      policy,
    });
    const queries = new LendQueries(storeWith(catalog));
    const answer = queries.listTokens({ ...NO_FILTER, token: 'usdc' });
    assert.deepEqual(answer.tokens.map((row) => row.tokenSymbol), ['USDC']);
  });
});

describe('KeepingTheCatalogCurrent', () => {
  const source = (name: string, pools: ReturnType<typeof pool>[], fails = false) => ({
    name,
    fetch: async () => {
      if (fails) throw new Error('upstream is down');
      return pools;
    },
  });

  test('a refresh publishes a catalog', async () => {
    const store = new CatalogStore(3);
    const refresher = new CatalogRefresher([source('kamino', [pool()])], store, policy, clock, 60_000);
    const published = await refresher.refreshOnce();
    assert.equal(published?.version, 1);
    assert.equal(store.current().listed.length, 1);
  });

  test('one broken source does not cost us the others', async () => {
    const store = new CatalogStore(3);
    const refresher = new CatalogRefresher(
      [source('broken', [], true), source('kamino', [pool()])],
      store,
      policy,
      clock,
      60_000,
    );
    const published = await refresher.refreshOnce();
    assert.deepEqual(published?.failedSources, ['broken']);
    assert.equal(published?.listed.length, 1);
  });

  test('an empty refresh never replaces a good catalog', async () => {
    const store = new CatalogStore(3);
    const good = new CatalogRefresher([source('kamino', [pool()])], store, policy, clock, 60_000);
    await good.refreshOnce();
    const empty = new CatalogRefresher([source('kamino', [])], store, policy, clock, 60_000);
    const kept = await empty.refreshOnce();
    assert.equal(kept?.version, 1);
    assert.equal(store.current().version, 1);
  });

  test('nothing to serve is not an empty list', async () => {
    const store = new CatalogStore(3);
    const refresher = new CatalogRefresher([source('kamino', [], true)], store, policy, clock, 60_000);
    assert.equal(await refresher.refreshOnce(), null);
    assert.equal(store.isReady, false);
  });

  test('the startup grace does not outlive the pass it was waiting for', async () => {
    const store = new CatalogStore(3);
    const refresher = new CatalogRefresher([source('kamino', [pool()])], store, policy, clock, 60_000);
    const before = timersRunning();
    refresher.start();
    await refresher.waitForFirstPass(2000);
    refresher.stop();
    assert.equal(store.isReady, true);
    assert.equal(timersRunning(), before);
  });

  test('the store keeps a bounded history', () => {
    const store = new CatalogStore(2);
    for (const version of [1, 2, 3]) store.publish(withPools(1, version));
    assert.equal(store.ofVersion(1), null);
    assert.equal(store.ofVersion(3)?.version, 3);
    assert.equal(store.nextVersion(), 4);
  });
});
