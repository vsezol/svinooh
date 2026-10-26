import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { Prisma } from '@prisma/client';
import type { PrismaService } from '@svinooh/db';
import type { PremiumService } from '../src/billing/premium.service';
import { PortfolioService } from '../src/portfolio/portfolio.service';
import type { ScanRequests } from '../src/wallet/scan-requests.service';

const OWNER = 'user-1';
const ADDRESS = '0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97';
const OTHER = '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5';

interface Row {
  id: string;
  chain: string;
  address: string;
}

interface Hold {
  id: string;
  portfolioId: string;
  walletId: string;
  label: string | null;
}

/**
 * One owned portfolio over a database that refuses a second hold on the same
 * address, the way the unique index on (portfolioId, walletId) does. Every
 * read and write yields first, so two requests started together interleave
 * the way they do against a real database.
 */
function standing(cap: number | null = null) {
  const wallets: Row[] = [];
  const holds: Hold[] = [];
  const scanned: string[] = [];
  const yieldFirst = () => new Promise((resolve) => setImmediate(resolve));
  const withWallet = (hold: Hold) => {
    const wallet = wallets.find((one) => one.id === hold.walletId)!;
    return {
      ...hold,
      wallet: {
        ...wallet,
        status: 'pending',
        lastSyncedAt: null,
        lastTotalUsd: null,
        lastError: null,
        nextScanAt: new Date(0),
        breakdown: null,
        unpriced: null,
        tronResources: null,
        tronResourcesAt: null,
        createdAt: new Date('2026-09-28T00:00:00Z'),
        positions: [],
      },
    };
  };

  const prisma = {
    portfolio: {
      findUnique: async () => ({ id: 'p-1', slug: 'mine', owner: { userId: OWNER } }),
    },
    wallet: {
      upsert: async ({ where }: { where: { chain_address: { chain: string; address: string } } }) => {
        await yieldFirst();
        const { chain, address } = where.chain_address;
        let wallet = wallets.find((one) => one.chain === chain && one.address === address);
        if (!wallet) {
          wallet = { id: `w-${wallets.length + 1}`, chain, address };
          wallets.push(wallet);
        }
        return { ...wallet, lastSyncedAt: null };
      },
    },
    portfolioWallet: {
      count: async () => holds.length,
      findFirst: async ({
        where,
      }: {
        where: { portfolioId: string; wallet: { chain: string; address: string } };
      }) => {
        await yieldFirst();
        const wallet = wallets.find(
          (one) => one.chain === where.wallet.chain && one.address === where.wallet.address,
        );
        const hold = wallet
          ? holds.find((one) => one.portfolioId === where.portfolioId && one.walletId === wallet.id)
          : undefined;
        return hold ? withWallet(hold) : null;
      },
      create: async ({ data }: { data: { portfolioId: string; walletId: string } }) => {
        await yieldFirst();
        if (holds.some((one) => one.portfolioId === data.portfolioId && one.walletId === data.walletId)) {
          throw new Prisma.PrismaClientKnownRequestError(
            'Unique constraint failed on the fields: (`portfolioId`,`walletId`)',
            { code: 'P2002', clientVersion: 'test' },
          );
        }
        const hold = { id: `pw-${holds.length + 1}`, ...data, label: null };
        holds.push(hold);
        return withWallet(hold);
      },
    },
  } as unknown as PrismaService;

  const premium = {
    walletCap: async () => cap,
    paywall: () => new Error('paywall'),
  } as unknown as PremiumService;
  const scans = { now: (walletId: string) => scanned.push(walletId) } as unknown as ScanRequests;

  return { holds, scanned, portfolios: new PortfolioService(prisma, premium, scans) };
}

describe('AddingAWalletTwiceIsAddingItOnce', () => {
  test('the first time the wallet goes in, and its first scan is asked for', async () => {
    const { holds, scanned, portfolios } = standing();
    const added = await portfolios.addWallet('mine', OWNER, ADDRESS);
    assert.equal(added.created, true);
    assert.equal(added.wallet.address, ADDRESS);
    assert.equal(holds.length, 1);
    assert.deepEqual(scanned, ['w-1']);
  });

  test('the second time answers with the same wallet and changes nothing', async () => {
    const { holds, scanned, portfolios } = standing();
    const first = await portfolios.addWallet('mine', OWNER, ADDRESS);
    const again = await portfolios.addWallet('mine', OWNER, ADDRESS);
    assert.equal(again.created, false);
    assert.deepEqual(again.wallet, first.wallet);
    assert.equal(holds.length, 1);
    assert.equal(scanned.length, 1, 'no second scan for a wallet already there');
  });

  test('the same address spelled another way is the same wallet', async () => {
    const { holds, portfolios } = standing();
    await portfolios.addWallet('mine', OWNER, ADDRESS);
    const shouted = await portfolios.addWallet('mine', OWNER, `  ${ADDRESS.toUpperCase().replace('0X', '0x')}  `);
    assert.equal(shouted.created, false);
    assert.equal(holds.length, 1);
  });

  test('at the cap, a repeat gets its wallet back and a new one gets the paywall', async () => {
    const { portfolios } = standing(1);
    await portfolios.addWallet('mine', OWNER, ADDRESS);
    const again = await portfolios.addWallet('mine', OWNER, ADDRESS);
    assert.equal(again.created, false);
    await assert.rejects(portfolios.addWallet('mine', OWNER, OTHER), /paywall/);
  });

  test('two at once both succeed, with one row and one scan between them', async () => {
    const { holds, scanned, portfolios } = standing();
    const both = await Promise.all([
      portfolios.addWallet('mine', OWNER, ADDRESS),
      portfolios.addWallet('mine', OWNER, ADDRESS),
    ]);
    assert.deepEqual(both.map((one) => one.created).sort(), [false, true]);
    assert.equal(both[0].wallet.id, both[1].wallet.id);
    assert.equal(holds.length, 1);
    assert.equal(scanned.length, 1);
  });
});
