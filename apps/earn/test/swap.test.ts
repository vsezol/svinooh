import { strict as assert } from 'node:assert';
import { afterEach, describe, test } from 'node:test';
import { kaminoRoutes } from '../src/infrastructure/kamino/swap';
import { alreadyWrapped, once } from '../src/infrastructure/kamino/withdrawals';
import { pool } from './support';

const OWNER = '5Hb8BfQVmvEhaKsoXBV2g3EExoqTCKsVNXrGsrbadHJS';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WSOL = 'So11111111111111111111111111111111111111112';
const JUPITER = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

const ix = (programId: string, data: number[], writable = true) => ({
  programId,
  data: Buffer.from(data).toString('base64'),
  keys: [{ pubkey: OWNER, isSigner: true, isWritable: writable }],
});

const route = (routerType: string, guaranteed: string, over: Record<string, unknown> = {}) => ({
  routerType,
  amountsExactIn: { amountOut: String(BigInt(guaranteed) + 100n), amountOutGuaranteed: guaranteed },
  simulationResult: { success: true },
  instructions: {
    createInAtaIxs: [],
    createOutAtaIxs: [ix('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', [1])],
    wrapSolIxs: [],
    swapIxs: [ix(JUPITER, [229, 23, 203])],
    unwrapSolIxs: [],
  },
  lookupTableAccountsBs58: [{ key: 'TABLE', state: { addresses: [USDC, WSOL] } }],
  ...over,
});

const asked = { tokenIn: USDC, tokenOut: WSOL, amount: 12_000_000n, owner: OWNER, slippageBps: 30, maxAccounts: 8, wrapSol: false };

const answering = (routes: unknown[]) => {
  const seen: string[] = [];
  globalThis.fetch = (async (url: string) => {
    seen.push(String(url));
    return { ok: true, status: 200, json: async () => ({ data: routes }) } as Response;
  }) as typeof fetch;
  return seen;
};

const real = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = real;
});

describe('WhatKaminoSwapOffers', () => {
  test('the route that surely pays most comes first', async () => {
    answering([route('okx', '100'), route('metis', '300'), route('dflow', '200')]);
    assert.deepEqual((await kaminoRoutes(asked)).map((one) => one.router), ['metis', 'dflow', 'okx']);
  });

  test('a router that answers with a whole transaction of its own is no use between two others', async () => {
    answering([route('jupiterZ', '999', { transactionBs58: 'abc' }), route('metis', '300')]);
    assert.deepEqual((await kaminoRoutes(asked)).map((one) => one.router), ['metis']);
  });

  test('a route its own simulation failed is not tried', async () => {
    answering([route('okx', '999', { simulationResult: { success: false } }), route('metis', '300')]);
    assert.deepEqual((await kaminoRoutes(asked)).map((one) => one.router), ['metis']);
  });

  test('instructions arrive ready to compose, and tables with their addresses', async () => {
    answering([route('metis', '300')]);
    const [only] = await kaminoRoutes(asked);
    assert.equal(only.instructions.length, 2, 'the account it pays into, then the swap');
    const swap = only.instructions[1] as { programAddress: string; data: Uint8Array; accounts: { role: number }[] };
    assert.equal(String(swap.programAddress), JUPITER);
    assert.deepEqual(Array.from(swap.data), [229, 23, 203]);
    assert.equal(swap.accounts[0].role, 3, 'a writable signer');
    assert.deepEqual(only.tables, { TABLE: [USDC, WSOL] });
    assert.equal(only.guaranteed, 300n);
  });

  test('it asks for the accounts to be created and for no logging instructions', async () => {
    const seen = answering([route('metis', '300')]);
    await kaminoRoutes(asked);
    const query = new URL(seen[0]).searchParams;
    assert.equal(query.get('includeSetupIxs'), 'true');
    assert.equal(query.get('includeLimoLogs'), 'false');
    assert.equal(query.get('amount'), '12000000');
    assert.equal(query.get('maxSlippageBps'), '30');
  });
});

describe('PuttingAMoveTogether', () => {
  const kit = import('@solana/kit');
  const instruction = async (program: string, data: number[], account = OWNER) => {
    const { address } = await kit;
    return { programAddress: address(program), accounts: [{ address: address(account), role: 1 }], data: Uint8Array.from(data) };
  };

  test('the same account created by both halves is created once', async () => {
    const create = await instruction('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', [1]);
    const again = await instruction('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', [1]);
    const other = await instruction('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', [1], USDC);
    assert.deepEqual(once([create, again, other]), [create, other]);
  });

  test('a SOL vault does not wrap SOL the swap has already wrapped', async () => {
    const transfer = await instruction('11111111111111111111111111111111', [2, 0, 0, 0]);
    const sync = await instruction('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', [17]);
    const deposit = await instruction('KvauGMspG5k6rtzrqqn7WNn3oZdyKqLKwK2XWQ8FLjd', [9]);
    const intoSol = pool({ token: { symbol: 'SOL', mint: WSOL, decimals: 9 } });
    assert.deepEqual(alreadyWrapped([transfer, sync, deposit], intoSol), [deposit]);
    assert.deepEqual(alreadyWrapped([transfer, sync, deposit], pool()), [transfer, sync, deposit], 'only for SOL');
  });
});
