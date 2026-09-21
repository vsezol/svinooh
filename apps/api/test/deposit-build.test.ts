import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { PrismaService } from '@svinooh/db';
import { DepositsController } from '../src/deposits/deposits.controller';
import { DepositsService } from '../src/deposits/deposits.service';
import type { ScanRequests } from '../src/wallet/scan-requests.service';

const OWNER = '5Hb8BfQVmvEhaKsoXBV2g3EExoqTCKsVNXrGsrbadHJS';
const PRIME = 'sol:kamino:vault:9E69U4GzWhryRaPe8DYpco6Z9vTZY6gg8w6W2QsBACEj';
const TURBO = 'sol:kamino:vault:A3hTCWdnfV6uiQLxRmnv17EpiEtmc93v1AGQnWy44Mup';

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
