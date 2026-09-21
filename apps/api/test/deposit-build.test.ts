import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { PrismaService } from '@svinooh/db';
import { DepositsController } from '../src/deposits/deposits.controller';
import { DepositsService } from '../src/deposits/deposits.service';
import type { ScanRequests } from '../src/wallet/scan-requests.service';

const OWNER = '5Hb8BfQVmvEhaKsoXBV2g3EExoqTCKsVNXrGsrbadHJS';
const PRIME = 'sol:kamino:vault:9E69U4GzWhryRaPe8DYpco6Z9vTZY6gg8w6W2QsBACEj';
const TURBO = 'sol:kamino:vault:A3hTCWdnfV6uiQLxRmnv17EpiEtmc93v1AGQnWy44Mup';
const SOL = 'So11111111111111111111111111111111111111112';
const USX = '6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG';

const BUILT = {
  transaction: 'AQAB',
  fee_payer: OWNER,
  instructions: 8,
  blockhash: 'b',
  last_valid_block_height: '1',
};

const building = () => {
  const asked: Array<{ path: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ path: decodeURIComponent(new URL(String(url)).pathname), body: JSON.parse(String(init.body)) });
    return { ok: true, status: 200, json: async () => ({ data: BUILT }) } as Response;
  }) as typeof fetch;
  const service = new DepositsService({} as PrismaService, {} as ScanRequests);
  return { asked, controller: new DepositsController(service) };
};

describe('WhatACardAsksEarnToBuild', () => {
  test('a deposit, as it always was', async () => {
    const { asked, controller } = building();
    await controller.build({ poolId: TURBO, amount: '12', owner: OWNER });
    assert.deepEqual(asked, [
      { path: `/v1/lend/pools/${TURBO}/deposit`, body: { amount: '12', owner: OWNER } },
    ]);
  });

  test('a withdrawal takes out of the pool the card is about', async () => {
    const { asked, controller } = building();
    await controller.build({ poolId: PRIME, amount: 'all', owner: OWNER, action: 'withdraw' });
    assert.deepEqual(asked, [
      { path: `/v1/lend/pools/${PRIME}/withdraw`, body: { amount: 'all', owner: OWNER } },
    ]);
  });

  test('a move leaves one pool for the pool the card is about', async () => {
    const { asked, controller } = building();
    await controller.build({
      poolId: TURBO,
      fromPoolId: PRIME,
      amount: 'all',
      owner: OWNER,
      action: 'move',
    });
    assert.deepEqual(asked, [
      { path: '/v1/lend/moves', body: { from: PRIME, to: TURBO, amount: 'all', owner: OWNER } },
    ]);
  });

  test('the second half of a move comes back with the first', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          data: { ...BUILT, then: { pool_id: TURBO, amount: '0.1012', holding: 'SOL' } },
        }),
      }) as Response) as typeof fetch;
    const service = new DepositsService({} as PrismaService, {} as ScanRequests);
    const built = await new DepositsController(service).build({
      poolId: TURBO,
      fromPoolId: PRIME,
      amount: 'all',
      owner: OWNER,
      action: 'move',
    });
    assert.deepEqual(built.then, { poolId: TURBO, amount: '0.1012', holding: 'SOL' });
  });

  test('a step that swaps from the wallet comes back saying what it spends and ends as', async () => {
    globalThis.fetch = (async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            ...BUILT,
            then: { amount: '0.566321', pay_with: USX, receive_as: SOL, holding: 'USX' },
          },
        }),
      }) as Response) as typeof fetch;
    const service = new DepositsService({} as PrismaService, {} as ScanRequests);
    const built = await new DepositsController(service).build({
      poolId: PRIME,
      amount: 'all',
      owner: OWNER,
      action: 'withdraw',
      receiveAs: SOL,
    });
    assert.deepEqual(built.then, { amount: '0.566321', payWith: USX, receiveAs: SOL, holding: 'USX' });
  });

  test('a withdrawal that ends as another coin is a move out of the pool into the wallet', async () => {
    const { asked, controller } = building();
    await controller.build({ poolId: PRIME, amount: 'all', owner: OWNER, action: 'withdraw', receiveAs: SOL });
    assert.deepEqual(asked, [
      { path: '/v1/lend/moves', body: { from: PRIME, to_coin: SOL, amount: 'all', owner: OWNER } },
    ]);
  });

  test('a deposit paid with another coin is a move from the wallet into the pool', async () => {
    const { asked, controller } = building();
    await controller.build({ poolId: TURBO, amount: '0.5', owner: OWNER, payWith: SOL });
    assert.deepEqual(asked, [
      { path: '/v1/lend/moves', body: { from_coin: SOL, to: TURBO, amount: '0.5', owner: OWNER } },
    ]);
  });

  test('a swap is one coin for another, with no pool', async () => {
    const { asked, controller } = building();
    await controller.build({ amount: '1', owner: OWNER, action: 'swap', payWith: USX, receiveAs: SOL });
    assert.deepEqual(asked, [
      { path: '/v1/lend/moves', body: { from_coin: USX, to_coin: SOL, amount: '1', owner: OWNER } },
    ]);
  });

  test('a swap that does not say both coins is refused before earn is asked', async () => {
    const { asked, controller } = building();
    await assert.rejects(
      () => controller.build({ amount: '1', owner: OWNER, action: 'swap', payWith: USX }),
      /payWith and receiveAs/,
    );
    assert.deepEqual(asked, []);
  });

  test('all of a coin can be paid in: the wallet says what all is', async () => {
    const { asked, controller } = building();
    await controller.build({ poolId: TURBO, amount: 'all', owner: OWNER, payWith: SOL });
    assert.equal(asked.length, 1);
  });

  test('a move that does not say where from is refused before earn is asked', async () => {
    const { asked, controller } = building();
    await assert.rejects(
      () => controller.build({ poolId: TURBO, amount: 'all', owner: OWNER, action: 'move' }),
      /fromPoolId/,
    );
    assert.deepEqual(asked, []);
  });

  test('a deposit of "all" is refused: a deposit is a number the wallet can check', async () => {
    const { asked, controller } = building();
    await assert.rejects(
      () => controller.build({ poolId: TURBO, amount: 'all', owner: OWNER }),
      /number of tokens/,
    );
    assert.deepEqual(asked, []);
  });

  test('an action nobody wired is refused, not sent on as a deposit', async () => {
    const { asked, controller } = building();
    await assert.rejects(
      () =>
        controller.build({ poolId: TURBO, amount: '1', owner: OWNER, action: 'borrow' as never }),
      /not something a card can ask for/,
    );
    assert.deepEqual(asked, []);
  });
});
