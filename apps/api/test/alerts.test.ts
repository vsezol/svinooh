/**
 * The path that replaced the wallet.state queue.
 *
 * The collector used to be reached by publishing a message; now the writer
 * calls it. Everything after that door is unchanged and its rules are
 * exercised by `npm run -w apps/api check:alerts` — what is worth a test here
 * is the door itself: an owner with a chat is told, an owner with nowhere to
 * be told is not, and the state is remembered either way so the day a chat
 * appears they are baselined rather than buried.
 */
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { RabbitService } from '@svinooh/common';
import type { PrismaService } from '@svinooh/db';
import type { WalletStateEvent } from '@svinooh/shared';
import { AlertsCollector } from '../src/alerts/collector.service';
import type { Trial } from '../src/alerts/trial.service';

const OUT_OF_RANGE: WalletStateEvent = {
  walletId: 'w-1',
  address: 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL',
  chain: 'SOL',
  positions: [
    {
      key: 'orca:ORCA:SOL/USDC::100-120',
      platform: 'ORCA',
      label: 'SOL/USDC',
      inRange: false,
      healthFactor: null,
      borrowApyPct: null,
      band: null,
      loan: null,
    },
  ],
  tron: null,
  unreachable: [],
  at: new Date().toISOString(),
};

const collector = (telegramId: bigint | null) => {
  const published: Array<{ queue: string; body: any }> = [];
  const remembered: Array<{ portfolioWalletId: string; positionKey: string }> = [];

  const prisma = {
    portfolioWallet: {
      findMany: async () => [
        {
          id: 'pw-1',
          label: 'Main',
          alerts: null, // no settings row: the defaults watch ranges
          portfolio: {
            slug: 'my-money',
            owner: { user: { id: 'u-1', telegramId, alertChatId: null, subscription: null } },
          },
        },
      ],
    },
    walletAlertState: {
      // it was in range last time, so this scan is a crossing
      findMany: async () => [
        {
          positionKey: 'orca:ORCA:SOL/USDC::100-120',
          inRange: true,
          healthBreached: false,
          borrowBreached: false,
          reclaimArmed: false,
          delegateArmed: false,
        },
      ],
      upsert: (args: any) => {
        remembered.push(args.where.portfolioWalletId_positionKey);
        return args;
      },
    },
    $transaction: async (ops: unknown[]) => ops,
  } as unknown as PrismaService;

  const rabbit = {
    publish: async (queue: string, body: unknown) => {
      published.push({ queue, body });
      return true;
    },
  } as unknown as RabbitService;

  const trial = { judge: async () => ({ verdict: 'send', count: false }) } as unknown as Trial;

  return { published, remembered, alerts: new AlertsCollector(prisma, rabbit, trial) };
};

describe('WhenTheWriterSaysWhatAnAddressLooksLike', () => {
  test('an owner with a chat is told, on the queue the bot reads', async () => {
    const { published, alerts } = collector(123n);
    await alerts.handle(OUT_OF_RANGE);
    assert.equal(published.length, 1);
    assert.equal(published[0].queue, 'alerts.telegram');
    assert.equal(published[0].body.telegramId, '123');
    assert.equal(published[0].body.portfolioSlug, 'my-money');
    assert.equal(published[0].body.items.length, 1);
  });

  test('an owner with nowhere to be told is not told — and is still remembered', async () => {
    const { published, remembered, alerts } = collector(null);
    await alerts.handle(OUT_OF_RANGE);
    assert.deepEqual(published, []);
    assert.deepEqual(remembered, [
      { portfolioWalletId: 'pw-1', positionKey: 'orca:ORCA:SOL/USDC::100-120' },
    ]);
  });
});
