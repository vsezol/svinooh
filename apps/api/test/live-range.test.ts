/**
 * The live range watch: bytes off the chain, and what is done about them.
 *
 * The two things that could go wrong quietly. Reading the wrong four bytes out
 * of a pool account would make up crossings that never happened, so the fixture
 * is a real mainnet account and the test fails the day the layout moves. And
 * asking for a scan too eagerly — on every push, or on a price flickering
 * across a boundary — would turn a swap into a queue of scans, so the cooldown
 * is exercised on the clock rather than trusted.
 *
 * No network and no database: the positions Meteora would report are handed in,
 * the pushes the socket would deliver are called directly.
 */
import { strict as assert } from 'node:assert';
import { describe, mock, test } from 'node:test';
import { MetricsService } from '@svinooh/common';
import type { PrismaService } from '@svinooh/db';
import { activeBinId, holds } from '../src/wallet/live/lb-pair';
import { RangeWatch } from '../src/wallet/live/range-watch.service';
import type { PoolFeed } from '../src/wallet/live/pool-feed.service';
import type { ScanRequests } from '../src/wallet/scan-requests.service';
import type { MeteoraWatchable } from '../src/wallet/scanners/defi/meteora';

/**
 * The first 80 bytes of the SOL-USDC DLMM pool, 5rCf1DM8LjKT…, read from
 * mainnet on 2026-09-21. Its active bin was -5380 and its bin step 4, which at
 * 9 and 6 decimals is (1 + 4/10_000)^-5380 · 10^3 — a SOL price of 116.30.
 */
const SOL_USDC =
  'IQsxYrVlsQ0QJx4AWAKIE8DUAQDgkwQAeFX+/4iqAQDoAwAAAAAAAC32AADdMgAA9+r//wAAAABL+rBqAAAAAAAAAAAAAAAA/wQAAPzq//8=';

const POOL = '5rCf1DM8LjKTw4YqhnoLcngyZYeNnQqztScTogYHAS6';
const ADDRESS = 'GBmnsSCtABHMHp2XUv9LaxXkT325a22X6aMR4dWoYU2';

/** A pool account as the socket delivers it, saying its price is in this bin */
const account = (bin: number): Buffer => {
  const data = Buffer.from(SOL_USDC, 'base64');
  data.writeInt32LE(bin, 76);
  return data;
};

describe('TheBytesOfAPool', () => {
  test('the active bin is read off a real account', () => {
    assert.equal(activeBinId(Buffer.from(SOL_USDC, 'base64')), -5380);
  });

  test('something that is not an LbPair is refused, not guessed at', () => {
    assert.equal(activeBinId(Buffer.alloc(40)), null, 'too short to hold the field');
    const moved = Buffer.alloc(120);
    moved.writeInt32LE(900_000, 76);
    assert.equal(activeBinId(moved), null, 'no pool has a bin that far out');
  });

  test('a position holds its own two ends', () => {
    const bins = { lowerBinId: -10, upperBinId: 10 };
    assert.equal(holds(bins, -10), true);
    assert.equal(holds(bins, 10), true);
    assert.equal(holds(bins, 0), true);
    assert.equal(holds(bins, -11), false);
    assert.equal(holds(bins, 11), false);
  });
});

const position = (over: Partial<MeteoraWatchable> = {}): MeteoraWatchable => ({
  poolAddress: POOL,
  positionAddress: 'CAuH4ppB93PW7T12RxTNYTkGv9R543a1CzFyHmsM5KUg',
  pairLabel: 'SOL/USDC',
  lowerBinId: -5400,
  upperBinId: -5340,
  activeBinId: -5380,
  inRange: true,
  ...over,
});

/** The watch, with Meteora's answer handed to it instead of fetched */
class Watch extends RangeWatch {
  constructor(
    private readonly answer: MeteoraWatchable[],
    ...rest: ConstructorParameters<typeof RangeWatch>
  ) {
    super(...rest);
  }
  protected override positionsOf(): Promise<MeteoraWatchable[]> {
    return Promise.resolve(this.answer);
  }
}

const watching = (positions: MeteoraWatchable[]) => {
  const watched: string[][] = [];
  const asked: string[] = [];
  let push: (account: string, data: Buffer) => void = () => {};
  const prisma = {
    position: {
      findMany: async () => [{ walletId: 'w-1', wallet: { address: ADDRESS } }],
    },
  } as unknown as PrismaService;
  const feed = {
    onAccount: (listener: (account: string, data: Buffer) => void) => {
      push = listener;
    },
    watch: (accounts: string[]) => watched.push(accounts),
  } as unknown as PoolFeed;
  const scans = { recheck: (walletId: string) => asked.push(walletId) } as unknown as ScanRequests;
  const watch = new Watch(positions, prisma, feed, scans, new MetricsService());
  return { watch, watched, asked, moved: (bin: number) => push(POOL, account(bin)) };
};

describe('APriceLeavingItsBand', () => {
  test('the pool is subscribed to, and what it is already doing is not news', async () => {
    const { watch, watched, asked, moved } = watching([position()]);
    await watch.tick();

    assert.deepEqual(watched.at(-1), [POOL], 'the pool a position is in is listened to');
    moved(-5390); // still inside the band, and a different bin
    assert.deepEqual(asked, [], 'a price moving within the band is not a crossing');
  });

  test('a crossing asks for that wallet to be read at once', async () => {
    const { watch, asked, moved } = watching([position()]);
    await watch.tick();

    moved(-5401); // one bin below the lower end
    assert.deepEqual(asked, ['w-1']);
  });

  test('the same bin arriving again says nothing — most pushes are fees, not price', async () => {
    const { watch, asked, moved } = watching([position()]);
    await watch.tick();

    moved(-5401);
    moved(-5401);
    moved(-5401);
    assert.deepEqual(asked, ['w-1'], 'one crossing, one read');
  });

  test('a price flickering across the line is one read, not one per flicker', async () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 });
    try {
      const { watch, asked, moved } = watching([position()]);
      await watch.tick();

      moved(-5401); // out
      moved(-5399); // back in, a second later
      moved(-5402); // and out again
      assert.deepEqual(asked, ['w-1'], 'the first went at once, the rest are waiting');

      mock.timers.tick(45_000); // the cooldown, as the registry declares it
      assert.deepEqual(asked, ['w-1', 'w-1'], 'everything that happened since is one read');
    } finally {
      mock.timers.reset();
    }
  });

  test('a position nobody holds any more is let go of', async () => {
    const { watch, watched } = watching([]);
    await watch.tick();
    assert.deepEqual(watched.at(-1), [], 'nothing held, nothing listened to');
  });
});
