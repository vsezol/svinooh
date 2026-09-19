/**
 * The scan pipeline, now that it lives in the api.
 *
 * Two things this move could have broken and nothing else would have noticed:
 * the way a just-added wallet is pushed to the front of the queue (it was an
 * HTTP call to another service and is now a method call), and the writer that
 * decides which readings to believe. Both are exercised here against fakes —
 * no database, no broker.
 */
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { Wallet } from '@prisma/client';
import { MetricsService, type RabbitService } from '@svinooh/common';
import type { PrismaService } from '@svinooh/db';
import type { ScanResult } from '@svinooh/shared';
import { ScanRequests } from '../src/wallet/scan-requests.service';
import { ScanResultConsumerService } from '../src/wallet/sync/scan-result-consumer.service';
import type { SyncService } from '../src/wallet/sync/sync.service';

const ADDRESS = 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL';

const reading = (totalUsd: number): ScanResult => ({
  chain: 'SOL',
  address: ADDRESS,
  totalUsd,
  positions: [{ symbol: 'SOL', valueUsd: totalUsd, category: 'token' }],
});

const walletRow = (over: Partial<Wallet> = {}): Wallet =>
  ({
    id: 'w-1',
    chain: 'SOL',
    address: ADDRESS,
    lastTotalUsd: null,
    unbelievedReadings: 0,
    lastSyncedAt: new Date(),
    tronResources: null,
    tronResourcesAt: null,
    ...over,
  }) as Wallet;

describe('AJustAddedWalletIsScannedNow', () => {
  const pipeline = (free: boolean) => {
    const published: Array<{ queue: string; priority?: number }> = [];
    const prisma = {
      wallet: { findUnique: async () => walletRow({ lastSyncedAt: null }) },
    } as unknown as PrismaService;
    const rabbit = {
      publish: async (queue: string, _job: unknown, opts?: { priority?: number }) => {
        published.push({ queue, priority: opts?.priority });
        return true;
      },
    } as unknown as RabbitService;
    const sync = { takeIfFree: async () => free } as unknown as SyncService;
    return { published, scans: new ScanRequests(prisma, rabbit, sync) };
  };

  test('the address is claimed, then published to its own queue, ahead of the rest', async () => {
    const { published, scans } = pipeline(true);
    scans.now('w-1');
    await new Promise((r) => setImmediate(r));
    assert.equal(published.length, 1);
    assert.equal(published[0].queue, 'scan.v2.sol');
    assert.ok((published[0].priority ?? 0) > 0, 'a spinner is being watched — it goes first');
  });

  test('an address somebody else is already scanning is not published twice', async () => {
    const { published, scans } = pipeline(false);
    scans.now('w-1');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(published, []);
  });
});

describe('TheWriterDecidesWhatToBelieve', () => {
  const writer = (wallet: Wallet) => {
    const applied: number[] = [];
    const unbelieved: number[] = [];
    const prisma = {
      wallet: { findUnique: async () => wallet },
    } as unknown as PrismaService;
    const sync = {
      tierOf: async () => 'active' as const,
      applyResult: async (_w: Wallet, r: { totalUsd: number }) => void applied.push(r.totalUsd),
      noteUnbelievedReading: async (_id: string, n: number) => void unbelieved.push(n),
      markFailed: async () => {},
    } as unknown as SyncService;
    const rabbit = { publish: async () => true } as unknown as RabbitService;
    return {
      applied,
      unbelieved,
      consumer: new ScanResultConsumerService(rabbit, prisma, sync, new MetricsService()),
    };
  };

  test('a first reading has nothing to be doubted against, and is stored', async () => {
    const { applied, consumer } = writer(walletRow());
    await consumer.apply({ chain: 'SOL', address: ADDRESS, ok: true, result: reading(1000), recheck: null });
    assert.deepEqual(applied, [1000]);
  });

  test('a collapse nobody re-read is not stored — it is counted', async () => {
    const { applied, unbelieved, consumer } = writer(walletRow({ lastTotalUsd: 10_000 }));
    await consumer.apply({ chain: 'SOL', address: ADDRESS, ok: true, result: reading(12), recheck: null });
    assert.deepEqual(applied, []);
    assert.deepEqual(unbelieved, [1]);
  });

  test('two readings that agree are believed, and the lower of them is the one stored', async () => {
    const { applied, consumer } = writer(walletRow({ lastTotalUsd: 10_000 }));
    await consumer.apply({
      chain: 'SOL',
      address: ADDRESS,
      ok: true,
      result: reading(4_000),
      recheck: reading(3_950),
    });
    assert.deepEqual(applied, [3_950]);
  });
});
