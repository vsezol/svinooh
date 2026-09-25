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

interface Step {
  poolId?: string;
  amount: string;
  payWith?: string;
  receiveAs?: string;
  holding: string;
}

interface Server {
  buildFails?: string;
  landingFails?: boolean;
  status?: string;
  /** What each landing after the first says, in turn; the rest say `status`. */
  later?: string[];
  /** The first build is half a move: a deposit into this pool follows it. */
  then?: Step;
  /** What each build says comes after it, in turn: a way round in several steps. */
  steps?: Step[];
  /** The build that comes after the first is refused, with this. */
  secondFails?: string;
}

const serving = (how: Server = {}) => {
  const asked: { path: string; body: unknown }[] = [];
  let builds = 0;
  let landings = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = String(url);
    asked.push({ path, body: JSON.parse(String(init.body)) });
    if (path.includes('/deposits/build')) {
      builds += 1;
      const refusal = builds === 1 ? how.buildFails : how.secondFails;
      const next = how.steps ? how.steps[builds - 1] : builds === 1 ? how.then : undefined;
      return refusal
        ? ({ ok: false, status: 422, json: async () => ({ message: refusal }) } as Response)
        : ({
            ok: true,
            status: 200,
            json: async () => ({
              transaction: TRANSACTION,
              feePayer: OWNER,
              instructions: 3,
              blockhash: 'b',
              lastValidBlockHeight: '1',
              ...(next ? { then: next } : {}),
            }),
          } as Response);
    }
    if (how.landingFails) throw new Error('the network is down');
    landings += 1;
    const status = (landings > 1 && how.later?.[landings - 2]) || how.status || 'landed';
    return {
      ok: true,
      status: 200,
      json: async () => ({
        signature: SIGNATURE,
        owner: OWNER,
        status,
        slot: 7,
        error: status === 'failed' ? '{"InstructionError":[3,{"Custom":1}]}' : null,
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


describe('AMoveInTwoTransactions', () => {
  const THEN = { poolId: 'sol:kamino:vault:ALLEZ', amount: '0.101202053', holding: 'SOL' };
  const moving = (how: Server = {}, made = {}) => {
    const asked = serving({ then: THEN, ...how });
    const fake = fakeWallet(made);
    const stages: DepositStage[] = [];
    return {
      asked,
      fake,
      stages,
      done: runDeposit({
        request: { ...REQUEST, action: 'move', amount: 'all', fromPoolId: 'sol:kamino:vault:PRIME' },
        wallet: depositWallet(fake.wallet),
        onStage: (stage) => stages.push(stage),
        wait: async () => {},
      }),
    };
  };
  const builds = (asked: { path: string; body: unknown }[]) =>
    asked.filter((one) => one.path.endsWith('/deposits/build')).map((one) => one.body);

  test('once the first half lands, the deposit of what it brought is built and signed', async () => {
    const { asked, fake, done } = moving();
    const finished = await done;
    assert.deepEqual(builds(asked)[1], {
      poolId: THEN.poolId,
      amount: THEN.amount,
      owner: OWNER,
      action: 'deposit',
    });
    assert.equal(fake.handed.length, 2, 'two signatures, one button');
    assert.ok('done' in finished && finished.done.ok && finished.done.landed === 'landed');
  });

  test('the person is told when the second half starts', async () => {
    const { stages, done } = moving();
    await done;
    assert.deepEqual(stages, [
      'building',
      'signing',
      'landing',
      'continuing',
      'signing',
      'landing',
    ]);
  });

  test('a first half the chain did not take is not followed by a second', async () => {
    const { asked, fake, done } = moving({ status: 'failed' });
    await done;
    assert.equal(builds(asked).length, 1);
    assert.equal(fake.handed.length, 1);
  });

  test('a second half that cannot be built leaves the money swapped in the wallet, and says so', async () => {
    const { done } = moving({ secondFails: 'the pool is full' });
    const finished = await done;
    assert.ok('done' in finished && finished.done.ok);
    assert.equal(finished.done.ok && finished.done.halfway, true);
    assert.equal(finished.done.ok && finished.done.error, 'the pool is full');
    assert.equal(finished.done.ok && finished.done.holding, 'SOL', 'what the money waits in');
  });

  test('a second half the network rejected is halfway, not a failure of the whole', async () => {
    const { done } = moving({ later: ['failed'] });
    const finished = await done;
    assert.ok('done' in finished && finished.done.ok && finished.done.halfway);
    assert.equal(finished.done.ok && finished.done.landed, 'landed', 'the first half did land');
  });

  test('a second signature refused is halfway too, not a failure of the whole', async () => {
    const asked = serving({ then: THEN });
    const fake = fakeWallet();
    const signer = depositWallet(fake.wallet);
    let signatures = 0;
    const wallet = {
      ...signer,
      connect: async () => {
        const connected = await signer.connect();
        return {
          ...connected,
          signAndSend: async (transaction: string) => {
            signatures += 1;
            if (signatures === 2) throw new Error('User rejected the request.');
            return connected.signAndSend(transaction);
          },
        };
      },
    };
    const finished = await runDeposit({
      request: { ...REQUEST, action: 'move', amount: 'all' },
      wallet,
      wait: async () => {},
    });
    assert.ok('done' in finished && finished.done.ok && finished.done.halfway);
    assert.equal(builds(asked).length, 2);
  });
});

describe('ALongerWayRound', () => {
  const USX = '6FrrzDk5mQARGc1TDYoyVnSyRdds1t4PbtohCD6p3tgG';
  const SOL = 'So11111111111111111111111111111111111111112';
  const USDS = 'USDSwr9ApdHk5bvJKMjzff41FfuX8bSxdKcR81vTwcA';
  const ALLEZ = 'sol:kamino:vault:ALLEZUSDC';
  const builds = (asked: { path: string; body: unknown }[]) =>
    asked.filter((one) => one.path.endsWith('/deposits/build')).map((one) => one.body);
  const run = async (request: DepositRequest, how: Server) => {
    const asked = serving(how);
    const fake = fakeWallet();
    const stages: DepositStage[] = [];
    const finished = await runDeposit({
      request,
      wallet: depositWallet(fake.wallet),
      onStage: (stage) => stages.push(stage),
      wait: async () => {},
    });
    return { asked, fake, stages, finished };
  };

  test('taking money out as another coin asks for the coin it ends as', async () => {
    const { asked } = await run(
      { ...REQUEST, action: 'withdraw', amount: 'all', receiveAs: { mint: SOL, symbol: 'SOL' } },
      {},
    );
    assert.deepEqual(builds(asked)[0], {
      poolId: REQUEST.poolId,
      amount: 'all',
      owner: OWNER,
      action: 'withdraw',
      receiveAs: SOL,
    });
  });

  test('a deposit paid with another coin says which', async () => {
    const { asked } = await run({ ...REQUEST, amount: '0.5', payWith: { mint: SOL, symbol: 'SOL' } }, {});
    assert.deepEqual(builds(asked)[0], {
      poolId: REQUEST.poolId,
      amount: '0.5',
      owner: OWNER,
      action: 'deposit',
      payWith: SOL,
    });
  });

  test('out first and the swap after, when the two would not fit together', async () => {
    const { asked, fake, finished } = await run(
      { ...REQUEST, action: 'withdraw', amount: 'all', receiveAs: { mint: SOL, symbol: 'SOL' } },
      { steps: [{ amount: '0.566321', payWith: USX, receiveAs: SOL, holding: 'USX' }] },
    );
    assert.deepEqual(builds(asked)[1], {
      poolId: REQUEST.poolId,
      amount: '0.566321',
      owner: OWNER,
      action: 'swap',
      payWith: USX,
      receiveAs: SOL,
    });
    assert.equal(fake.handed.length, 2);
    assert.ok('done' in finished && finished.done.ok && !finished.done.halfway);
  });

  test('out, swap and in: three signatures from one button, each built after the last landed', async () => {
    const { asked, fake, stages, finished } = await run(
      { ...REQUEST, action: 'move', amount: 'all', poolId: ALLEZ, fromPoolId: 'sol:kamino:vault:KEEL' },
      {
        steps: [
          { poolId: ALLEZ, amount: '5.103185', payWith: USDS, holding: 'USDS' },
          { poolId: ALLEZ, amount: '5.09', holding: 'USDC' },
        ],
      },
    );
    assert.deepEqual(builds(asked).slice(1), [
      { poolId: ALLEZ, amount: '5.103185', owner: OWNER, action: 'deposit', payWith: USDS },
      { poolId: ALLEZ, amount: '5.09', owner: OWNER, action: 'deposit' },
    ]);
    assert.equal(fake.handed.length, 3);
    assert.equal(stages.filter((stage) => stage === 'continuing').length, 2);
    assert.ok('done' in finished && finished.done.ok && finished.done.landed === 'landed');
  });

  test('stopping between steps says what the money waits in by then', async () => {
    const { finished } = await run(
      { ...REQUEST, action: 'move', amount: 'all', poolId: ALLEZ, fromPoolId: 'sol:kamino:vault:KEEL' },
      {
        steps: [
          { poolId: ALLEZ, amount: '5.103185', payWith: USDS, holding: 'USDS' },
          { poolId: ALLEZ, amount: '5.09', holding: 'USDC' },
        ],
        later: ['landed', 'failed'],
      },
    );
    assert.ok('done' in finished && finished.done.ok && finished.done.halfway);
    assert.equal(finished.done.ok && finished.done.holding, 'USDC');
  });
});

describe('LiquidityForAPair', () => {
  const PAIR = 'sol:meteora:dlmm:CgqwPL';
  const POSITION = '8PBf2k9bvDgWTWs8HjrwDXzhGfwsLgM1AHvHYfLPcCp';
  const builds = (asked: { path: string; body: unknown }[]) =>
    asked.filter((one) => one.path.endsWith('/deposits/build')).map((one) => one.body);
  const card: DepositRequest = {
    ...REQUEST,
    poolId: PAIR,
    pool: 'SOL-USDC',
    protocol: 'meteora',
    poolKind: 'dlmm',
    token: 'USDC',
    amount: '5',
    action: 'provide',
    payWith: { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', symbol: 'USDC' },
    belowPct: '10.3',
    abovePct: '5.5',
  };
  const run = async (request: DepositRequest, how: Server) => {
    const asked = serving(how);
    const fake = fakeWallet();
    const finished = await runDeposit({
      request,
      wallet: depositWallet(fake.wallet),
      wait: async () => {},
    });
    return { asked, fake, finished };
  };

  test('placing liquidity asks for the amount, the coin and the range', async () => {
    const { asked } = await run(card, {});
    assert.deepEqual(builds(asked)[0], {
      poolId: PAIR,
      amount: '5',
      owner: OWNER,
      action: 'provide',
      payWith: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      belowPct: '10.3',
      abovePct: '5.5',
    });
  });

  test('after the swap, the position is built for both tokens, and signed', async () => {
    const { asked, fake, finished } = await run(card, {
      steps: [
        {
          action: 'provide',
          poolId: PAIR,
          amountX: '0.013224704',
          amountY: '3.443325',
          belowPct: '10.3',
          abovePct: '5.5',
          holding: 'SOL and USDC',
        } as never,
      ],
    });
    assert.deepEqual(builds(asked)[1], {
      poolId: PAIR,
      owner: OWNER,
      action: 'provide',
      amountX: '0.013224704',
      amountY: '3.443325',
      belowPct: '10.3',
      abovePct: '5.5',
    });
    assert.equal(fake.handed.length, 2);
    assert.ok('done' in finished && finished.done.ok && finished.done.landed === 'landed');
  });

  test('a rebalance closes over two steps, then places what came back', async () => {
    const { asked, fake } = await run(
      { ...card, action: 'rebalance', amount: '', payWith: undefined, position: POSITION, belowPct: '5', abovePct: '5' },
      {
        steps: [
          { action: 'rebalance', position: POSITION, amountX: '0.0244', amountY: '9.28', belowPct: '5', abovePct: '5', holding: 'SOL and USDC' } as never,
          { action: 'provide', poolId: PAIR, amountX: '0.0244', amountY: '9.28', belowPct: '5', abovePct: '5', holding: 'SOL and USDC' } as never,
        ],
      },
    );
    assert.deepEqual(
      builds(asked).map((body) => (body as { action: string }).action),
      ['rebalance', 'rebalance', 'provide'],
    );
    assert.equal((builds(asked)[1] as { position: string }).position, POSITION);
    assert.equal(fake.handed.length, 3);
  });
});

describe('ThePageHearsOfEachStepThatLanded', () => {
  const heard = async (how: Server, request: DepositRequest = REQUEST) => {
    serving(how);
    let times = 0;
    await runDeposit({
      request,
      wallet: depositWallet(fakeWallet().wallet),
      onLanded: () => {
        times += 1;
      },
      wait: async () => {},
    });
    return times;
  };

  test('each step of several, as it lands, not only the last', async () => {
    const times = await heard(
      {
        steps: [
          { poolId: 'sol:kamino:vault:ALLEZ', amount: '5.103185', payWith: 'USDS', holding: 'USDS' },
          { poolId: 'sol:kamino:vault:ALLEZ', amount: '5.09', holding: 'USDC' },
        ],
      },
      { ...REQUEST, action: 'move', amount: 'all', fromPoolId: 'sol:kamino:vault:KEEL' },
    );
    assert.equal(times, 3);
  });

  test('and nothing of one the network refused', async () => {
    assert.equal(await heard({ status: 'failed' }), 0);
  });
});
