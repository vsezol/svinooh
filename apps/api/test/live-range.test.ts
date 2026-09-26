/**
 * The live range watch: bytes off the chain, and what is done about them.
 *
 * What could go wrong quietly. Reading the wrong four bytes out of a pool
 * account would make up crossings that never happened, so the fixture is a real
 * mainnet account and the test fails the day the layout moves. Believing every
 * crossing would turn a price sitting on a band's edge into a message per swap,
 * so the hold is exercised on the clock rather than trusted. A socket that
 * went quiet would leave a crossing unseen until the next scan, so Meteora's
 * own answer is shown to stand in for it — without winding back a newer push.
 * And a restart starts from what the last scan stored, so a crossing made
 * while the process was down is still a crossing.
 *
 * No network and no database: the positions Meteora would report are handed in,
 * the pushes the socket would deliver are called directly.
 */
import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
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

/** A row the last scan stored for a position, under the position's own address */
const row = (range: 'in' | 'out', ref: string | null = position().positionAddress) => ({
  walletId: 'w-1',
  ref,
  range,
});

/** As the registry declares it */
const HOLD_MS = 60_000;

/** The watch, with Meteora's answer handed to it instead of fetched */
class Watch extends RangeWatch {
  answer: MeteoraWatchable[] = [];
  /** Runs while Meteora is "being asked" — for a push that lands mid-answer */
  meanwhile: () => void = () => {};
  protected override positionsOf(): Promise<MeteoraWatchable[]> {
    this.meanwhile();
    return Promise.resolve(this.answer);
  }
}

const watching = (positions: MeteoraWatchable[], stored: Array<ReturnType<typeof row>> = []) => {
  const watched: string[][] = [];
  const asked: string[] = [];
  let push: (account: string, data: Buffer) => void = () => {};
  const prisma = {
    position: {
      // Two questions reach this table: which wallets to watch, and what the
      // last scan stored about their positions
      findMany: async (args: { select: { range?: boolean } }) =>
        args.select.range ? stored : [{ walletId: 'w-1', wallet: { address: ADDRESS } }],
    },
  } as unknown as PrismaService;
  const feed = {
    onAccount: (listener: (account: string, data: Buffer) => void) => {
      push = listener;
    },
    watch: (accounts: string[]) => watched.push(accounts),
  } as unknown as PoolFeed;
  const scans = { recheck: (walletId: string) => asked.push(walletId) } as unknown as ScanRequests;
  const watch = new Watch(prisma, feed, scans, new MetricsService());
  watch.answer = positions;
  return { watch, watched, asked, moved: (bin: number) => push(POOL, account(bin)) };
};

describe('APriceLeavingItsBand', () => {
  beforeEach(() => mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 }));
  afterEach(() => mock.timers.reset());

  test('the pool is subscribed to, and what it is already doing is not news', async () => {
    const { watch, watched, asked, moved } = watching([position()]);
    await watch.tick();

    assert.deepEqual(watched.at(-1), [POOL], 'the pool a position is in is listened to');
    moved(-5390); // still inside the band, and a different bin
    mock.timers.tick(HOLD_MS);
    assert.deepEqual(asked, [], 'a price moving within the band is not a crossing');
  });

  test('a crossing that holds asks for the wallet to be read, once the hold is up', async () => {
    const { watch, asked, moved } = watching([position()]);
    await watch.tick();

    moved(-5401); // one bin below the lower end
    assert.deepEqual(asked, [], 'not believed yet');
    mock.timers.tick(HOLD_MS - 1);
    assert.deepEqual(asked, [], 'still not');
    mock.timers.tick(1);
    assert.deepEqual(asked, ['w-1']);
  });

  test('a crossing that reverses inside the hold was never news', async () => {
    const { watch, asked, moved } = watching([position()]);
    await watch.tick();

    moved(-5401);
    mock.timers.tick(20_000);
    moved(-5390);
    mock.timers.tick(HOLD_MS * 2);
    assert.deepEqual(asked, []);
  });

  test('a price on the edge for fifteen minutes is one read, when it finally settles', async () => {
    // The 2026-09-21 trace: -21454/-21453 and back, fourteen times
    const { watch, asked, moved } = watching([position({ lowerBinId: -5400, upperBinId: -5380 })]);
    await watch.tick();

    for (let i = 0; i < 14; i++) {
      moved(-5379); // out, above the upper end
      mock.timers.tick(15_000);
      moved(-5380); // back on the edge, inside
      mock.timers.tick(15_000);
    }
    assert.deepEqual(asked, [], 'fourteen flickers, no reads');
    moved(-5379);
    mock.timers.tick(HOLD_MS);
    assert.deepEqual(asked, ['w-1'], 'and then it stayed out');
  });

  test('the same bin arriving again says nothing — most pushes are fees, not price', async () => {
    const { watch, asked, moved } = watching([position()]);
    await watch.tick();

    moved(-5401);
    moved(-5401);
    moved(-5401);
    mock.timers.tick(HOLD_MS);
    assert.deepEqual(asked, ['w-1'], 'one crossing, one read');
  });

  test('a socket that went quiet: Meteora\'s answer is the reading instead', async () => {
    const { watch, asked } = watching([position()]);
    await watch.tick();

    // No push arrives. By the next pass the pool has left the band
    watch.answer = [position({ activeBinId: -5405, inRange: false })];
    await watch.tick();
    mock.timers.tick(HOLD_MS);
    assert.deepEqual(asked, ['w-1']);
  });

  test("Meteora's answer does not wind back a push that arrived while it was asked", async () => {
    const { watch, asked, moved } = watching([position()]);
    await watch.tick();

    // Meteora answers "in", but a push saying "out" lands after the question
    watch.meanwhile = () => {
      mock.timers.tick(1_000);
      moved(-5401);
    };
    await watch.tick();
    watch.meanwhile = () => {};
    mock.timers.tick(HOLD_MS);
    assert.deepEqual(asked, ['w-1'], 'the push is newer, and it stands');
  });

  test('a restart: what changed while nobody was watching is read', async () => {
    // The last scan stored "in"; by the time the process is back, the chain
    // says out — the owner has not been told, and the watch is how they are
    const { watch, asked } = watching([position({ activeBinId: -5405, inRange: false })], [row('in')]);
    await watch.tick();
    assert.deepEqual(asked, [], 'through the hold like any crossing');
    mock.timers.tick(HOLD_MS);
    assert.deepEqual(asked, ['w-1']);
  });

  test('a restart where nothing changed reads nothing', async () => {
    const { watch, asked } = watching([position({ activeBinId: -5405, inRange: false })], [row('out')]);
    await watch.tick();
    mock.timers.tick(HOLD_MS * 2);
    assert.deepEqual(asked, []);
  });

  test('a stored row of another position is not this one', async () => {
    const { watch, asked } = watching(
      [position({ activeBinId: -5405, inRange: false })],
      [row('in', 'AnotherPositionInTheSamePool1111111111111111'), row('in', null)],
    );
    await watch.tick();
    mock.timers.tick(HOLD_MS * 2);
    assert.deepEqual(asked, [], 'nothing stored under its address, so it starts from the chain');
  });

  test('two positions with one band each start from their own row', async () => {
    const twin = 'TwinPositionWithTheSameBand11111111111111111';
    const { watch, asked } = watching(
      [
        position({ activeBinId: -5405, inRange: false }),
        position({ positionAddress: twin, activeBinId: -5405, inRange: false }),
      ],
      [row('out'), row('in', twin)],
    );
    await watch.tick();
    mock.timers.tick(HOLD_MS);
    assert.deepEqual(asked, ['w-1'], 'the twin was stored in range, and it is not any more');
  });

  test('a position nobody holds any more is let go of', async () => {
    const { watch, watched } = watching([]);
    await watch.tick();
    assert.deepEqual(watched.at(-1), [], 'nothing held, nothing listened to');
  });
});
