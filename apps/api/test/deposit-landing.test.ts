import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { PrismaService } from '@svinooh/db';
import { DepositsService } from '../src/deposits/deposits.service';
import type { ScanRequests, WalletAfterLanding } from '../src/wallet/scan-requests.service';

const SIGNATURE = '5ndCyVRV3mQRLmTdhKbJdFVWEPfYhfqZmAaLvQnqaJ8pZJqvHkBQ7kkbXHbPMRLzrXhDcQAqfHuNvAhVQDWkZqYh';
const OWNER = 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL';

type Tracked = { walletId: string; portfolio: { slug: string } } | null;

const standing = (
  landing: { status: string; slot: number | null; error: string | null },
  tracked: Tracked,
  left: unknown = null,
) => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    if (String(url).includes('/effects?')) {
      if (left instanceof Error) throw left;
      return { ok: true, status: 200, json: async () => ({ data: left }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ data: landing }) } as Response;
  }) as typeof fetch;

  const prisma = {
    portfolioWallet: { findFirst: async () => tracked },
  } as unknown as PrismaService;

  const rescanned: Array<[string, WalletAfterLanding | null]> = [];
  const scans = {
    landed: (walletId: string, after: WalletAfterLanding | null) => rescanned.push([walletId, after]),
  } as unknown as ScanRequests;

  return { calls, rescanned, deposits: new DepositsService(prisma, scans) };
};

const settled = async () => {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve));
};

const LANDED = { status: 'landed', slot: 4, error: null };

describe('WhenADepositLands', () => {
  test('a chain still thinking about it is not a landing, and scans nothing', async () => {
    const { calls, deposits } = standing({ status: 'pending', slot: null, error: null }, null);
    const seen = await deposits.landed(SIGNATURE, OWNER, 'sol', 'user-1');
    assert.equal(seen.status, 'pending');
    assert.equal(seen.tracked, false);
    assert.equal(calls.length, 1);
    assert.match(calls[0], /\/v1\/lend\/deposits\//);
  });

  test('a landing on a tracked address asks for that wallet to be read again', async () => {
    const { calls, rescanned, deposits } = standing(LANDED, {
      walletId: 'w-1',
      portfolio: { slug: 'my-money' },
    });
    const seen = await deposits.landed(SIGNATURE, OWNER, 'sol', 'user-1');
    assert.deepEqual(seen, {
      status: 'landed',
      slot: 4,
      error: null,
      tracked: true,
      portfolio: 'my-money',
    });
    await settled();
    assert.equal(calls.length, 2);
    assert.match(calls[1], new RegExp(`/v1/lend/deposits/${SIGNATURE}/effects\\?network=sol&owner=${OWNER}`));
    assert.deepEqual(rescanned, [['w-1', null]]);
  });

  test('what the chain says the landing left goes with the rescan, in figures', async () => {
    const { rescanned, deposits } = standing(
      LANDED,
      { walletId: 'w-1', portfolio: { slug: 'my-money' } },
      {
        slot: 371_802_114,
        coins: [{ mint: 'So1', symbol: 'SOL', amount: '0.062747282', price_usd: '117.14' }],
        vaults: [
          {
            pool_id: 'sol:kamino:vault:VAULT',
            address: 'VAULT',
            farm: 'FARM',
            shares_mint: 'SHARES',
            name: 'USDC Prime',
            token: { symbol: 'USDC', mint: 'EPjF' },
            amount: '0',
            price_usd: '0.9999',
            apy: '0.049433',
          },
        ],
        pairs: [
          {
            pool: {
              id: 'sol:meteora:dlmm:BVRbyL',
              x: { symbol: 'SOL' },
              y: { symbol: 'USDC' },
              base_fee_pct: '0.2',
              price: '116.968',
            },
            price_x_usd: '117.14',
            price_y_usd: '0.9999',
            positions: [
              {
                address: '955Jz',
                lower_price: '110.825218',
                upper_price: '122.7135139',
                in_range: true,
                amount_x: '0.046605273',
                amount_y: '6.541655',
                value_usd: '12.00',
                fees_usd: '0.00',
              },
            ],
          },
        ],
      },
    );
    await deposits.landed(SIGNATURE, OWNER, 'sol', 'user-1');
    await settled();
    assert.deepEqual(rescanned, [
      [
        'w-1',
        {
          slot: 371_802_114,
          coins: [{ mint: 'So1', symbol: 'SOL', amount: 0.062747282, priceUsd: 117.14 }],
          vaults: [
            {
              address: 'VAULT',
              farm: 'FARM',
              sharesMint: 'SHARES',
              name: 'USDC Prime',
              token: 'USDC',
              amount: 0,
              priceUsd: 0.9999,
              apy: 0.049433,
            },
          ],
          pairs: [
            {
              address: 'BVRbyL',
              x: 'SOL',
              y: 'USDC',
              feePct: 0.2,
              price: 116.968,
              priceXUsd: 117.14,
              priceYUsd: 0.9999,
              positions: [
                {
                  address: '955Jz',
                  amountX: 0.046605273,
                  amountY: 6.541655,
                  lowerPrice: 110.825218,
                  upperPrice: 122.7135139,
                  inRange: true,
                  feesUsd: 0,
                },
              ],
            },
          ],
        },
      ],
    ]);
  });

  test('earn not saying what was left does not stop the rescan', async () => {
    const { rescanned, deposits } = standing(
      LANDED,
      { walletId: 'w-1', portfolio: { slug: 'my-money' } },
      new Error('socket hang up'),
    );
    const seen = await deposits.landed(SIGNATURE, OWNER, 'sol', 'user-1');
    assert.equal(seen.status, 'landed');
    await settled();
    assert.deepEqual(rescanned, [['w-1', null]]);
  });

  test('a landing from an address this account does not hold scans nothing', async () => {
    const { calls, rescanned, deposits } = standing(LANDED, null);
    const seen = await deposits.landed(SIGNATURE, OWNER, 'sol', 'user-1');
    assert.equal(seen.status, 'landed');
    assert.equal(seen.tracked, false);
    assert.equal(seen.portfolio, null);
    assert.equal(calls.length, 1);
    assert.deepEqual(rescanned, []);
  });

  test('a chain nobody follows is refused before earn is asked', async () => {
    const { calls, deposits } = standing(LANDED, null);
    await assert.rejects(() => deposits.landed(SIGNATURE, OWNER, 'eth', 'user-1'), /eth deposits/);
    assert.equal(calls.length, 0);
  });

  test('a failure on the chain keeps its reason and stays a failure', async () => {
    const { deposits } = standing(
      { status: 'failed', slot: 9, error: 'InsufficientFunds' },
      { walletId: 'w-1', portfolio: { slug: 'my-money' } },
    );
    const seen = await deposits.landed(SIGNATURE, OWNER, 'sol', 'user-1');
    assert.equal(seen.status, 'failed');
    assert.equal(seen.error, 'InsufficientFunds');
    assert.equal(seen.tracked, false);
  });
});
