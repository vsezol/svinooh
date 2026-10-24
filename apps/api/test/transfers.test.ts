import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { base58Decode } from '@svinooh/common';
import { priceCache, pricesAt, tronHexToBase58, type Transfer } from '../src/portfolio/transfer-sources';
import { crossings, type HeldAddress } from '../src/portfolio/transfers';

const A: HeldAddress = { id: 'w-a', chain: 'EVM', address: '0x4838b106fce9647bdf1e7877bf73ce8b0bad5f97' };
const B: HeldAddress = { id: 'w-b', chain: 'EVM', address: '0x95222290dd7278aa3ddd389cc1e1d165cc4bafe5' };
const OUTSIDE = '0x00000000219ab540356cbb839cbe05303d7705fa';

const transfer = (over: Partial<Transfer>): Transfer => ({
  txHash: '0x1',
  at: new Date('2026-10-20T10:00:00Z'),
  direction: 'out',
  counterparty: OUTSIDE,
  network: 'eth',
  symbol: 'USDC',
  amount: 100,
  usd: 100,
  ...over,
});

test('a move between two of the portfolio wallets is neither a deposit nor a withdrawal', () => {
  const rows = crossings(
    [
      { wallet: A, transfers: [transfer({ txHash: '0xmove', counterparty: B.address.toUpperCase().replace('0X', '0x') })] },
      { wallet: B, transfers: [transfer({ txHash: '0xmove', direction: 'in', counterparty: A.address })] },
    ],
    [A, B],
  );
  assert.deepEqual(rows, []);
});

test('money to and from outside is listed newest first, legs of one transaction together, dust left out', () => {
  const rows = crossings(
    [
      {
        wallet: A,
        transfers: [
          transfer({ txHash: '0xout', symbol: 'USDC', usd: 100 }),
          transfer({ txHash: '0xout', symbol: 'ETH', amount: 0.1, usd: 250 }),
          transfer({ txHash: '0xin', direction: 'in', at: new Date('2026-10-21T10:00:00Z'), usd: 40 }),
          transfer({ txHash: '0xdust', direction: 'in', usd: 0.99 }),
        ],
      },
    ],
    [A, B],
  );
  assert.deepEqual(
    rows.map((r) => [r.txHash, r.direction, r.usd, r.legs.length, r.walletId]),
    [
      ['0xin', 'in', 40, 1, 'w-a'],
      ['0xout', 'out', 350, 2, 'w-a'],
    ],
  );
});

test('TronGrid hex addresses come back in the base58 spelling we store', () => {
  const address = 'TEF8gN62a3v8cH956eGe2NNfPoZQsrZfi3';
  const hex = Buffer.from(base58Decode(address)!.subarray(0, 21)).toString('hex');
  assert.equal(tronHexToBase58(hex), address);
  assert.equal(tronHexToBase58('not-hex'), null);
});

test('a past hour is priced once; a price DefiLlama lacks today is asked again', async () => {
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const coins = JSON.parse(decodeURIComponent(new URL(url).searchParams.get('coins')!)) as Record<string, number[]>;
    asked.push(...Object.keys(coins));
    const answer = { 'coingecko:tron': { prices: coins['coingecko:tron']?.map((t) => ({ timestamp: t + 60, price: 0.3 })) } };
    return new Response(JSON.stringify({ coins: answer }));
  }) as typeof fetch;

  try {
    priceCache.clear();
    const lastWeek = new Date(Date.now() - 7 * 86400e3);
    const now = new Date();
    await pricesAt([{ coin: 'coingecko:tron', at: lastWeek }, { coin: 'tron:Tunknown', at: now }]);
    await pricesAt([{ coin: 'coingecko:tron', at: lastWeek }, { coin: 'tron:Tunknown', at: now }]);
    assert.deepEqual(asked, ['coingecko:tron', 'tron:Tunknown', 'tron:Tunknown']);
    assert.equal([...priceCache.values()][0], 0.3);
  } finally {
    globalThis.fetch = realFetch;
  }
});
