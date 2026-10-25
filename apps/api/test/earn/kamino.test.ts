import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { KaminoApi } from '../../src/earn/infrastructure/kamino/api';
import { KaminoSource } from '../../src/earn/infrastructure/kamino/source';
import { net } from '../../src/earn/domain/pool';
import { idOf } from '../../src/earn/domain/values';
import { RecordedKamino } from './fixtures/kamino';

const fetched = async (includeReserves = true) => {
  const upstream = new RecordedKamino();
  const pools = await new KaminoSource(new KaminoApi(upstream), includeReserves).fetch();
  return { pools, upstream };
};

const byId = (pools: Awaited<ReturnType<typeof fetched>>['pools'], id: string) =>
  pools.find((pool) => idOf(pool.id) === id);

describe('ReadingKamino', () => {
  test('a vault becomes a pool, with the rate split by where it comes from', async () => {
    const { pools } = await fetched();
    const vault = byId(pools, 'sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK');
    assert.ok(vault);
    assert.equal(vault.name, 'Sentora PYUSD');
    assert.equal(vault.token.symbol, 'PYUSD');
    assert.equal(vault.token.decimals, 6);
    assert.equal(vault.apy.base.toFixed(6), '0.025752');
    assert.equal(vault.apy.rewards.toFixed(6), '0.025043');
    assert.equal(net(vault.apy).toFixed(4), '0.0508');
    assert.equal(vault.tvlUsd.toFixed(2), '135323782.29');
    assert.equal(vault.holders, 3667);
    assert.equal(vault.deposit.programId, 'KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd');
  });

  test('a minimum deposit is scaled into whole tokens', async () => {
    const { pools } = await fetched();
    const vault = byId(pools, 'sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK');
    assert.equal(vault?.deposit.minAmount?.toString(), '0.1');
  });

  test('allocations are renormalised over the reserves that are live', async () => {
    const { pools } = await fetched();
    const vault = byId(pools, 'sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK');
    assert.equal(vault?.allocations.length, 2, 'the zero-weight reserve is not money anywhere');
    const total = vault!.allocations.reduce((sum, one) => sum + Number(one.weightPct), 0);
    assert.ok(Math.abs(total - 100) < 1e-9);
    assert.equal(vault!.allocations[0].marketName, 'Ethena Market');
    assert.equal(vault!.allocations[0].tokenSymbol, 'PYUSD');
  });

  test('a reserve becomes a pool that says what it lends and to whom', async () => {
    const { pools } = await fetched();
    const reserve = byId(pools, 'sol:kamino:reserve:d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q');
    assert.ok(reserve);
    assert.equal(reserve.name, 'SOL · SOL/BTC Market');
    assert.equal(reserve.apy.base.toFixed(6), '0.045123');
    assert.equal(reserve.borrowApy?.toFixed(4), '0.0597');
    assert.equal(reserve.liquidity.utilization?.toFixed(4), '0.8975');
    assert.equal(
      reserve.deposit.lendingMarket,
      '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF',
    );
  });

  test('a mint learns its decimals from the vault that states them', async () => {
    const { pools } = await fetched();
    const pyusd = byId(pools, 'sol:kamino:reserve:2gc9Dm1eB6UgVYFBUN9bWks6Kes9PbWSaPaa9DqyvEiN');
    assert.equal(pyusd?.token.decimals, 6, 'reserve metrics never report decimals');
  });

  test('metrics are read one page after another', async () => {
    const { upstream } = await fetched();
    const metricCalls = upstream.calls.filter((path) => path === '/kvaults/vaults/metrics');
    assert.equal(metricCalls.length, 2);
  });

  test('reserves can be left out without costing the tickers they carry', async () => {
    const { pools } = await fetched(false);
    assert.ok(pools.every((pool) => pool.id.kind === 'vault'));
    const vault = byId(pools, 'sol:kamino:vault:A2wsxhA7pF4B2UKVfXocb6TAAP9ipfPJam6oMKgDE5BK');
    assert.equal(vault?.token.symbol, 'PYUSD');
  });
});
