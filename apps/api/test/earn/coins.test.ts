import { strict as assert } from 'node:assert';
import { afterEach, describe, test } from 'node:test';
import { coinsVia } from '../../src/earn/infrastructure/coins';

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

const listed = (id: string, symbol: string, over: Record<string, unknown> = {}) => ({
  id,
  symbol,
  decimals: 6,
  tokenProgram: TOKEN,
  isVerified: true,
  liquidity: 1_000,
  ...over,
});

const answering = (found: unknown[] | Error) => {
  const asked: string[] = [];
  globalThis.fetch = (async (url: string) => {
    asked.push(decodeURIComponent(String(url)));
    if (found instanceof Error) throw found;
    return { ok: true, status: 200, json: async () => found } as Response;
  }) as typeof fetch;
  return asked;
};

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

const find = coinsVia('http://127.0.0.1:1');

describe('FindingACoinSomebodyNamed', () => {
  test('a ticker is the verified coin under it, the one with most money behind it', async () => {
    answering([
      listed('Fake1111111111111111111111111111111111111111', 'JUP', { isVerified: false, liquidity: 9e9 }),
      listed('Thin1111111111111111111111111111111111111111', 'JUP', { liquidity: 10 }),
      listed(JUP, 'JUP', { liquidity: 4_782_404 }),
      listed('jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v', 'JupSOL', { liquidity: 6e8 }),
    ]);
    assert.deepEqual(await find('jup', []), { symbol: 'JUP', mint: JUP, decimals: 6, program: TOKEN });
  });

  test('a ticker only unverified coins answer to is nobody', async () => {
    answering([listed('Fake1111111111111111111111111111111111111111', 'USDC', { isVerified: false })]);
    assert.equal(await find('USDC', []), null);
  });

  test('SOL is native SOL, without asking anybody', async () => {
    const asked = answering(new Error('nobody should be asked'));
    const sol = await find('sol', []);
    assert.equal(sol?.mint, 'So11111111111111111111111111111111111111112');
    assert.equal(sol?.decimals, 9);
    assert.deepEqual(asked, []);
  });

  test('a mint is that token, whatever the directory calls it', async () => {
    const asked = answering([listed(JUP, 'JUP', { isVerified: false })]);
    assert.equal((await find(JUP, []))?.symbol, 'JUP');
    assert.match(asked[0], new RegExp(`query=${JUP}`));
  });

  test('a directory nobody can reach is no coin, not a crash', async () => {
    answering(new Error('down'));
    assert.equal(await find('bonk', []), null);
  });
});
