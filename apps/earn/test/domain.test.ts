import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { Decimal } from 'decimal.js';
import { buildCatalog, find, isStale, permits } from '../src/domain/catalog';
import { apply, fingerprint, paginate, NO_FILTER, DEFAULT_SORT } from '../src/domain/selection';
import { tokenYields } from '../src/domain/tokens';
import { idOf, parseId } from '../src/domain/values';
import { policy, pool } from './support';

describe('WhatIsWorthListing', () => {
  test('only pools worth listing are listed', () => {
    const catalog = buildCatalog({
      version: 1,
      takenAt: new Date(),
      pools: [
        pool({ address: 'BIG' }),
        pool({ address: 'THIN', tvlUsd: new Decimal('11000') }),
        pool({ address: 'DEAD', apy: { base: new Decimal(0), rewards: new Decimal(0), incentives: new Decimal(0) } }),
        pool({ address: 'TEST', name: 'Steakhouse USDC Testing' }),
      ],
      policy,
    });
    assert.deepEqual(
      catalog.listed.map((one) => one.id.address),
      ['BIG'],
    );
  });

  test('an unlisted pool is still addressable', () => {
    const thin = pool({ address: 'THIN', tvlUsd: new Decimal('11000') });
    const catalog = buildCatalog({ version: 1, takenAt: new Date(), pools: [thin], policy });
    assert.equal(catalog.listed.length, 0);
    assert.equal(find(catalog, thin.id)?.id.address, 'THIN');
  });

  test('staleness is a question about a moment', () => {
    const takenAt = new Date('2026-09-10T12:00:00Z');
    const catalog = buildCatalog({ version: 1, takenAt, pools: [pool()], policy });
    assert.equal(isStale(catalog, new Date('2026-09-10T12:10:00Z'), 900_000), false);
    assert.equal(isStale(catalog, new Date('2026-09-10T12:20:00Z'), 900_000), true);
  });

  test('a pool paying nothing is not an answer to where can i earn', () => {
    const dead = pool({ apy: { base: new Decimal(0), rewards: new Decimal(0), incentives: new Decimal(0) } });
    assert.equal(permits(policy, dead), false);
  });
});

describe('ChoosingPoolsOutOfACatalog', () => {
  const pools = [
    pool({ address: 'A', name: 'alpha', tvlUsd: new Decimal('1000000'), apy: { base: new Decimal('0.01'), rewards: new Decimal(0), incentives: new Decimal(0) } }),
    pool({ address: 'B', name: 'bravo', tvlUsd: new Decimal('3000000'), apy: { base: new Decimal('0.09'), rewards: new Decimal(0), incentives: new Decimal(0) } }),
    pool({ address: 'C', name: 'charlie', tvlUsd: new Decimal('2000000'), apy: { base: new Decimal('0.05'), rewards: new Decimal(0), incentives: new Decimal(0) } }),
  ];

  test('the default order is the best rate first', () => {
    const ordered = apply({ filter: NO_FILTER, sort: DEFAULT_SORT }, pools);
    assert.deepEqual(ordered.map((one) => one.id.address), ['B', 'C', 'A']);
  });

  test('every sort the api offers is a real order', () => {
    const order = (key: 'apy' | 'tvl_usd' | 'name', descending: boolean) =>
      apply({ filter: NO_FILTER, sort: { key, descending } }, pools).map((one) => one.id.address);
    assert.deepEqual(order('apy', false), ['A', 'C', 'B']);
    assert.deepEqual(order('tvl_usd', true), ['B', 'C', 'A']);
    assert.deepEqual(order('name', false), ['A', 'B', 'C']);
    assert.deepEqual(order('name', true), ['C', 'B', 'A']);
  });

  test('a tie keeps a stable order between requests', () => {
    const same = new Decimal('0.05');
    const tied = [
      pool({ address: 'ZZZ', apy: { base: same, rewards: new Decimal(0), incentives: new Decimal(0) } }),
      pool({ address: 'AAA', apy: { base: same, rewards: new Decimal(0), incentives: new Decimal(0) } }),
    ];
    const once = apply({ filter: NO_FILTER, sort: DEFAULT_SORT }, tied).map((one) => idOf(one.id));
    const again = apply({ filter: NO_FILTER, sort: DEFAULT_SORT }, [...tied].reverse()).map((one) => idOf(one.id));
    assert.deepEqual(once, again);
  });

  test('a fingerprint names the list, not the page size', () => {
    const one = { filter: { ...NO_FILTER, token: 'usdc' }, sort: DEFAULT_SORT };
    const same = { filter: { ...NO_FILTER, token: 'USDC' }, sort: DEFAULT_SORT };
    const other = { filter: { ...NO_FILTER, token: 'SOL' }, sort: DEFAULT_SORT };
    assert.equal(fingerprint(one), fingerprint(same));
    assert.notEqual(fingerprint(one), fingerprint(other));
  });

  test('a page knows where the next one starts and when there is none', () => {
    const first = paginate(pools, 0, 2);
    assert.equal(first.total, 3);
    assert.equal(first.nextOffset, 2);
    assert.equal(paginate(pools, 2, 2).nextOffset, null);
  });
});

describe('WhatATokenCanEarn', () => {
  test('a token row points at its best pool', () => {
    const rows = tokenYields([
      pool({ address: 'LOW', apy: { base: new Decimal('0.02'), rewards: new Decimal(0), incentives: new Decimal(0) } }),
      pool({ address: 'HIGH', apy: { base: new Decimal('0.08'), rewards: new Decimal(0), incentives: new Decimal(0) } }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].poolCount, 2);
    assert.equal(rows[0].best.id.address, 'HIGH');
    assert.equal(rows[0].totalTvl.toString(), '84000000');
  });

  test('rows are ordered by where the market is', () => {
    const rows = tokenYields([
      pool({ address: 'A', token: { symbol: 'USDC', mint: 'EPjF', decimals: 6 }, tvlUsd: new Decimal('1000') }),
      pool({ address: 'B', token: { symbol: 'SOL', mint: 'So111', decimals: 9 }, tvlUsd: new Decimal('9000') }),
    ]);
    assert.deepEqual(rows.map((row) => row.tokenSymbol), ['SOL', 'USDC']);
  });
});

describe('APoolIdIsSelfContained', () => {
  test('it writes down everything needed to resolve it', () => {
    assert.equal(idOf({ network: 'sol', protocol: 'kamino', kind: 'vault', address: 'AAA' }), 'sol:kamino:vault:AAA');
  });

  test('and reads back only what this service issued', () => {
    assert.deepEqual(parseId('sol:kamino:reserve:XYZ'), {
      network: 'sol',
      protocol: 'kamino',
      kind: 'reserve',
      address: 'XYZ',
    });
    for (const wrong of ['', 'sol:kamino:vault', 'sol:kamino:vault:', 'eth:aave:vault:AAA', 'sol:kamino:farm:AAA']) {
      assert.equal(parseId(wrong), null, wrong);
    }
  });
});
