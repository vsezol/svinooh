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
import { describe, mock, test } from 'node:test';
import type { Wallet } from '@prisma/client';
import { MetricsService, type RabbitService } from '@svinooh/common';
import type { PrismaService } from '@svinooh/db';
import type { ScanResult } from '@svinooh/shared';
import { CATCHING_UP_MS, ScanRequests } from '../src/wallet/scan-requests.service';
import { LandingOverlay } from '../src/wallet/sync/landing-overlay';
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
    const leased: string[] = [];
    const sync = {
      takeIfFree: async () => free,
      lease: async (addresses: Array<{ address: string }>) => {
        leased.push(...addresses.map((a) => a.address));
      },
    } as unknown as SyncService;
    return { published, leased, scans: new ScanRequests(prisma, rabbit, sync, new LandingOverlay()) };
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

  test('a landed deposit is read at once, not when the clock next says so', async () => {
    // The clock had this address scheduled five minutes out. That reading was
    // taken before the money moved, and yielding to it is four minutes of
    // somebody staring at a wallet that does not show what they just did.
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { published, leased, scans } = pipeline(false);
      scans.landed('w-1');
      await new Promise((r) => setImmediate(r));
      assert.equal(published.length, 1, 'read now, whatever the schedule says');
      assert.deepEqual(leased, [ADDRESS]);
    } finally {
      mock.timers.reset();
    }
  });

  test('and read again while the indexers catch up with the chain', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const { published, scans } = pipeline(false);
      scans.landed('w-1');
      await new Promise((r) => setImmediate(r));
      for (const after of CATCHING_UP_MS) {
        mock.timers.tick(after - (CATCHING_UP_MS[CATCHING_UP_MS.indexOf(after) - 1] ?? 0));
        await new Promise((r) => setImmediate(r));
      }
      assert.equal(published.length, 1 + CATCHING_UP_MS.length);
      assert.ok(Math.max(...CATCHING_UP_MS) <= 60_000, 'all of it inside the minute the page is watching');
    } finally {
      mock.timers.reset();
    }
  });

  test('a recheck is read now even when the clock says it is not due', async () => {
    // The live watch saw the price leave a band: the reading the clock is
    // waiting on was taken before that happened, so this one does not wait
    const { published, leased, scans } = pipeline(false);
    scans.recheck('w-1');
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(leased, [ADDRESS], 'the claim is taken, not asked for');
    assert.equal(published.length, 1);
    assert.equal(published[0].queue, 'scan.v2.sol');
    assert.ok((published[0].priority ?? 0) > 0, 'ahead of the routine top-ups');
  });
});

const writer = (wallet: Wallet, overlay = new LandingOverlay()) => {
  const applied: number[] = [];
  const stored: ScanResult[] = [];
  const unbelieved: number[] = [];
  const prisma = {
    wallet: { findUnique: async () => wallet },
  } as unknown as PrismaService;
  const sync = {
    tierOf: async () => 'active' as const,
    applyResult: async (_w: Wallet, r: ScanResult) => {
      applied.push(r.totalUsd);
      stored.push(r);
    },
    noteUnbelievedReading: async (_id: string, n: number) => void unbelieved.push(n),
    markFailed: async () => {},
  } as unknown as SyncService;
  const rabbit = { publish: async () => true } as unknown as RabbitService;
  return {
    applied,
    unbelieved,
    stored,
    consumer: new ScanResultConsumerService(rabbit, prisma, sync, new MetricsService(), overlay),
  };
};

describe('TheWriterDecidesWhatToBelieve', () => {
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

describe('AReadingTakenBeforeTheIndexersCaughtUp', () => {
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
  const SOL = '11111111111111111111111111111111';
  const FARM = '6XmZCys8MMyMZuUGcMJGSDjXRfTxHNkK6xHNn9RmwJK8';

  const stale = (): ScanResult => ({
    chain: 'SOL',
    address: ADDRESS,
    totalUsd: 24.41,
    breakdown: { defi: 24.41, gmtrade: 0 },
    positions: [
      { symbol: 'Kamino', name: 'Farming', valueUsd: 12.01, category: 'defi', platform: 'kamino', pool: FARM },
      { symbol: 'SOL', amount: 0.106, priceUsd: 117, valueUsd: 12.4, category: 'token', platform: 'wallet', ref: SOL },
    ],
  });

  test('is stored with what the chain said right after the landing', async () => {
    const overlay = new LandingOverlay();
    overlay.hold('w-1', {
      slot: 100,
      coins: [
        { mint: SOL, symbol: 'SOL', amount: 0.106297173, priceUsd: 117.16 },
        { mint: USDC, symbol: 'USDC', amount: 12.00764, priceUsd: 0.9999 },
      ],
      vaults: [
        {
          address: '9E69U4GzWhryRaPe8DYpco6Z9vTZY6gg8w6W2QsBACEj',
          farm: FARM,
          sharesMint: '9YHNzyKwsdZ54GirTp6wSMweL9twT6sxF9RJPeE6aXem',
          name: 'USDC Prime',
          token: 'USDC',
          amount: 0,
          priceUsd: 0.9999,
          apy: 0.049,
        },
      ],
      pairs: [],
    });
    const { stored, consumer } = writer(walletRow({ lastTotalUsd: 24.41 }), overlay);
    await consumer.apply({ chain: 'SOL', address: ADDRESS, ok: true, result: stale(), recheck: null });
    const [written] = stored;
    assert.deepEqual(
      written.positions.map((one) => [one.symbol, one.ref ?? one.pool]),
      [
        ['SOL', SOL],
        ['USDC', USDC],
      ],
    );
    assert.ok(Math.abs(written.totalUsd - (0.106297173 * 117 + 12.00764 * 0.9999)) < 1e-9);
  });

  test('and a wallet nothing landed in is stored exactly as it was read', async () => {
    const { stored, consumer } = writer(walletRow({ lastTotalUsd: 24.41 }));
    await consumer.apply({ chain: 'SOL', address: ADDRESS, ok: true, result: stale(), recheck: null });
    assert.deepEqual(stored, [stale()]);
  });
});
