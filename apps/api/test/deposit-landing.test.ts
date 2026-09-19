import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { PrismaService } from '@svinooh/db';
import { DepositsService } from '../src/deposits/deposits.service';

const SIGNATURE = '5ndCyVRV3mQRLmTdhKbJdFVWEPfYhfqZmAaLvQnqaJ8pZJqvHkBQ7kkbXHbPMRLzrXhDcQAqfHuNvAhVQDWkZqYh';
const OWNER = 'EiN7zKfhj7TAwibNDRDhWqELSv9bgMcRsmG6Kz8DcYNL';

type Tracked = { walletId: string; portfolio: { slug: string } } | null;

const standing = (
  landing: { status: string; slot: number | null; error: string | null },
  tracked: Tracked,
) => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ data: landing }) } as Response;
  }) as typeof fetch;

  const prisma = {
    portfolioWallet: { findFirst: async () => tracked },
  } as unknown as PrismaService;

  return { calls, deposits: new DepositsService(prisma) };
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
    const { calls, deposits } = standing(LANDED, {
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
    assert.equal(calls.length, 2);
    assert.match(calls[1], /\/internal\/scan$/);
  });

  test('a landing from an address this account does not hold scans nothing', async () => {
    const { calls, deposits } = standing(LANDED, null);
    const seen = await deposits.landed(SIGNATURE, OWNER, 'sol', 'user-1');
    assert.equal(seen.status, 'landed');
    assert.equal(seen.tracked, false);
    assert.equal(seen.portfolio, null);
    assert.equal(calls.length, 1);
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
