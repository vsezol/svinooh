import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { DepositRequest } from '../src/lib/deposit';
import { runDeposit, type DepositStage } from '../src/lib/deposit/run';
import { base58, depositWallet } from '../src/lib/deposit/wallet';
import { fakeWallet, OWNER } from './support/fake-wallet';

const BYTES = new Uint8Array([1, 0, 2, 255, 128, 7]);
const TRANSACTION = Buffer.from(BYTES).toString('base64');
const SIGNATURE = base58(new Uint8Array(64).fill(9));

const REQUEST: DepositRequest = {
  poolId: 'sol:kamino:vault:AAA',
  pool: 'Kamino USDC',
  protocol: 'kamino',
  poolKind: 'vault',
  network: 'sol',
  token: 'USDC',
  amount: '12.0014',
};

interface Server {
  buildFails?: string;
  landingFails?: boolean;
  status?: string;
}

const serving = (how: Server = {}) => {
  const asked: { path: string; body: unknown }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = String(url);
    asked.push({ path, body: JSON.parse(String(init.body)) });
    if (path.includes('/deposits/build')) {
      return how.buildFails
        ? ({ ok: false, status: 422, json: async () => ({ message: how.buildFails }) } as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({
              transaction: TRANSACTION,
              feePayer: OWNER,
              instructions: 3,
              blockhash: 'b',
              lastValidBlockHeight: '1',
            }),
          } as Response);
    }
    if (how.landingFails) throw new Error('the network is down');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        signature: SIGNATURE,
        owner: OWNER,
        status: how.status ?? 'landed',
        slot: 7,
        error: null,
        tracked: true,
        portfolio: 'vivid-cozy-stork',
      }),
    } as Response;
  }) as unknown as typeof fetch;
  return asked;
};

const run = (how: Server = {}, made = {}) => {
  const asked = serving(how);
  const fake = fakeWallet(made);
  const stages: DepositStage[] = [];
  return {
    asked,
    fake,
    stages,
    done: runDeposit({
      request: REQUEST,
      wallet: depositWallet(fake.wallet),
      onStage: (stage) => stages.push(stage),
      wait: async () => {},
    }),
  };
};

describe('ADepositFromTheButtonToTheChain', () => {
  test('the build is asked for this pool, this amount and this wallet', async () => {
    const { asked, done } = run();
    await done;
    assert.equal(asked[0].path.endsWith('/api/deposits/build'), true);
    assert.deepEqual(asked[0].body, {
      poolId: REQUEST.poolId,
      amount: REQUEST.amount,
      owner: OWNER,
      action: 'deposit',
    });
  });

  test('a withdrawal and a move ride the same path, saying which they are', async () => {
    const asked = serving();
    const fake = fakeWallet();
    await runDeposit({
      request: { ...REQUEST, action: 'withdraw', amount: 'all' },
      wallet: depositWallet(fake.wallet),
      wait: async () => {},
    });
    await runDeposit({
      request: { ...REQUEST, action: 'move', amount: 'all', fromPoolId: 'sol:kamino:vault:PRIME' },
      wallet: depositWallet(fake.wallet),
      wait: async () => {},
    });
    const builds = asked.filter((one) => one.path.endsWith('/deposits/build')).map((one) => one.body);
    assert.deepEqual(builds, [
      { poolId: REQUEST.poolId, amount: 'all', owner: OWNER, action: 'withdraw' },
      {
        poolId: REQUEST.poolId,
        amount: 'all',
        owner: OWNER,
        action: 'move',
        fromPoolId: 'sol:kamino:vault:PRIME',
      },
    ]);
    assert.equal(fake.handed.length, 2, 'each was handed to the wallet to sign');
  });

  test('what the server built is what the wallet is handed', async () => {
    const { fake, done } = run();
    await done;
    assert.deepEqual(fake.handed[0].transaction, BYTES);
  });

  test('what the wallet signed is what the chain is asked about', async () => {
    const { asked, done } = run();
    await done;
    assert.deepEqual(asked[1].body, { signature: SIGNATURE, owner: OWNER, network: 'sol' });
  });

  test('a landed deposit comes back with its signature and its receipt', async () => {
    const { done } = run();
    assert.deepEqual(await done, {
      done: { ok: true, signature: SIGNATURE, landed: 'landed', tracked: true, error: null },
    });
  });

  test('the person is told where the turn is, in order', async () => {
    const { stages, done } = run();
    await done;
    assert.deepEqual(stages, ['building', 'signing', 'landing']);
  });

  test('a failed deposit is not called landed', async () => {
    const { done } = run({ status: 'failed' });
    const finished = await done;
    assert.equal('done' in finished && finished.done.ok && finished.done.landed, 'failed');
  });
});

describe('WhenADepositDoesNotHappen', () => {
  test("a refusal in the wallet is said in the wallet's words, and nothing is claimed", async () => {
    const { done } = run({}, { refuse: 'User rejected the request.' });
    assert.deepEqual(await done, { failed: 'User rejected the request.', at: 'wallet' });
  });

  test('where it stopped is carried, because a refused build is news and a refusal is not', async () => {
    const refused = await run({ buildFails: 'not enough SOL for rent' }).done;
    const rejected = await run({}, { refuse: 'User rejected the request.' }).done;
    assert.equal('failed' in refused && refused.at, 'build');
    assert.equal('failed' in rejected && rejected.at, 'wallet');
  });

  test('a build the server refuses never reaches the wallet', async () => {
    const { fake, stages, done } = run({ buildFails: 'this deposit is 1328 bytes' });
    assert.deepEqual(await done, { failed: 'this deposit is 1328 bytes', at: 'build' });
    assert.deepEqual(fake.handed, []);
    assert.deepEqual(stages, ['building']);
  });

  test('a wallet that cannot connect stops before the build is asked for', async () => {
    const asked = serving();
    const fake = fakeWallet();
    const wallet = { ...depositWallet(fake.wallet), connect: async () => {
      throw new Error('Phantom is locked');
    } };
    assert.deepEqual(await runDeposit({ request: REQUEST, wallet }), {
      failed: 'Phantom is locked',
      at: 'connect',
    });
    assert.deepEqual(asked, []);
  });

  test('money that left the wallet is reported even if the chain cannot be reached', async () => {
    const { done } = run({ landingFails: true });
    assert.deepEqual(await done, {
      done: { ok: true, signature: SIGNATURE, landed: undefined, tracked: undefined, error: null },
    });
  });
});
