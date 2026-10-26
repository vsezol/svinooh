import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  afterDeposit,
  promiseOf,
  rangeOf,
  requestOf,
  settledOf,
  sizeOf,
} from '../src/agent/components/blocks/DepositBlock';
import type { DepositRequest } from '../src/agent/app/types';
import type { DepositBlock } from '../src/agent/app/types';

const card: DepositBlock = {
  kind: 'deposit',
  poolId: 'sol:kamino:vault:AAA',
  pool: 'Steakhouse USDC',
  protocol: 'kamino',
  poolKind: 'vault',
  network: 'sol',
  token: 'USDC',
  amount: '250',
  apy: '5.12%',
  risk: 'low',
  url: 'https://kamino.finance/earn/lend/AAA',
};

describe('WhatTheHostIsHandedAndWhatComesBack', () => {
  test('the host is handed what it needs to build the deposit, and no more', () => {
    assert.deepEqual(requestOf(card), {
      poolId: card.poolId,
      pool: card.pool,
      protocol: card.protocol,
      poolKind: card.poolKind,
      network: card.network,
      token: card.token,
      amount: card.amount,
      action: 'deposit',
    });
  });

  test('a move hands over where the money leaves, as well as where it goes', () => {
    const move = requestOf({
      ...card,
      action: 'move',
      amount: 'all',
      fromPoolId: 'sol:kamino:vault:PRIME',
      fromPool: 'USDC Prime',
    });
    assert.equal(move.action, 'move');
    assert.equal(move.amount, 'all');
    assert.equal(move.fromPoolId, 'sol:kamino:vault:PRIME');
    assert.equal(move.fromPool, 'USDC Prime');
  });

  test('a move across tokens is counted in the token it leaves, and says what it becomes', () => {
    assert.equal(
      sizeOf({ ...card, amount: 'all', shown: '12.0016', fromToken: 'USDC', token: 'SOL' }),
      '12.0016 USDC → SOL',
    );
    assert.equal(sizeOf({ ...card, amount: 'all', shown: '12.0016', fromToken: 'USDC' }), '12.0016 USDC');
  });

  test('a deposit paid with another coin is counted in that coin, and says what it becomes', () => {
    const paid = { ...card, amount: '0.5', payWith: { mint: 'So11', symbol: 'SOL' } };
    assert.equal(sizeOf(paid), '0.5 SOL → USDC');
    assert.deepEqual(requestOf(paid).payWith, { mint: 'So11', symbol: 'SOL' });
    assert.match(promiseOf(paid), /SOL becomes USDC on the way/);
    assert.match(promiseOf(paid), /sign more than once/);
  });

  test('a withdrawal taken out as another coin says what it comes back as', () => {
    const out = {
      ...card,
      action: 'withdraw' as const,
      token: 'SOL',
      amount: 'all',
      shown: '0.1',
      receiveAs: { mint: 'EPjF', symbol: 'USDC' },
    };
    assert.equal(sizeOf(out), '0.1 SOL → USDC');
    assert.deepEqual(requestOf(out).receiveAs, { mint: 'EPjF', symbol: 'USDC' });
  });

  test('nothing is promised about a swap there is not', () => {
    assert.equal(promiseOf(card), 'Your money goes straight to the protocol. Nothing moves until you sign.');
  });

  test('half a move is told as half, with why the second half did not happen', () => {
    const told = settledOf({ ...card, action: 'move', amount: 'all' } as never, {
      ok: true,
      signature: '5xy',
      landed: 'landed',
      halfway: true,
      error: 'User rejected the request.',
    });
    assert.equal(told?.halfway, true);
    assert.equal(told?.error, 'User rejected the request.');
  });

  test('"all" is shown as the figure it was worth, not as the word', () => {
    assert.equal(sizeOf({ ...card, amount: 'all', shown: '12.001555' }), '12.001555 USDC');
    assert.equal(sizeOf({ ...card, amount: '5' }), '5 USDC');
  });

  test('a refusal keeps its reason', () => {
    assert.deepEqual(afterDeposit({ ok: false, reason: 'user rejected it' }), {
      state: 'refused',
      note: 'user rejected it',
      signature: null,
    });
  });

  test('a host that only knows about signing is still understood', () => {
    assert.deepEqual(afterDeposit({ ok: true, signature: '5xy' }), {
      state: 'signed',
      note: '5xy',
      signature: '5xy',
    });
  });

  test('a host that answers nothing is still an answer', () => {
    assert.deepEqual(afterDeposit(undefined), { state: 'signed', note: null, signature: null });
  });

  test('a deposit that landed says where it went', () => {
    const settled = afterDeposit({ ok: true, signature: '5xy', landed: 'landed', tracked: true });
    assert.equal(settled.state, 'landed');
    assert.match(settled.note ?? '', /portfolio is being read/);
  });

  test('a deposit from an address the portfolio does not hold says so', () => {
    const settled = afterDeposit({ ok: true, signature: '5xy', landed: 'landed', tracked: false });
    assert.equal(settled.state, 'landed');
    assert.match(settled.note ?? '', /not in your portfolio/);
  });

  test('a transaction the chain rejected is not a signed deposit', () => {
    const settled = afterDeposit({
      ok: true,
      signature: '5xy',
      landed: 'failed',
      error: 'InsufficientFunds',
    });
    assert.equal(settled.state, 'refused');
    assert.equal(settled.note, 'InsufficientFunds');
  });

  test('a transaction still in the air says exactly that', () => {
    const settled = afterDeposit({ ok: true, signature: '5xy', landed: 'pending' });
    assert.equal(settled.state, 'signed');
    assert.match(settled.note ?? '', /has not confirmed/);
  });
});

describe('WhatTheAgentIsToldAfterASignature', () => {
  const request: DepositRequest = {
    poolId: 'sol:kamino:vault:AAA',
    pool: 'Elemental USDC Turbo',
    protocol: 'kamino',
    poolKind: 'vault',
    network: 'sol',
    token: 'USDC',
    amount: '12.0014',
  };

  test('a landed deposit is told as landed, with what it was', () => {
    assert.deepEqual(settledOf(request, { ok: true, signature: '5xy', landed: 'landed' }), {
      amount: '12.0014',
      token: 'USDC',
      pool: 'Elemental USDC Turbo',
      action: 'deposit',
      from_pool: null,
      status: 'landed',
      signature: '5xy',
      error: null,
    });
  });

  test('a move is told as a move, from where to where', () => {
    const told = settledOf(
      { ...request, action: 'move', fromPoolId: 'sol:kamino:vault:PRIME', fromPool: 'USDC Prime' },
      { ok: true, signature: '5xy', landed: 'landed' },
    );
    assert.equal(told?.action, 'move');
    assert.equal(told?.from_pool, 'USDC Prime');
  });

  test('what was swapped is told in what left and what it became', () => {
    const told = settledOf(
      {
        ...request,
        action: 'withdraw',
        token: 'SOL',
        amount: '0.1',
        receiveAs: { mint: 'EPjF', symbol: 'USDC' },
      },
      { ok: true, signature: '5xy', landed: 'landed' },
    );
    assert.equal(told?.token, 'SOL');
    assert.equal(told?.into, 'USDC');
    const paid = settledOf(
      { ...request, amount: '0.5', payWith: { mint: 'So11', symbol: 'SOL' } },
      { ok: true, signature: '5xy', landed: 'landed' },
    );
    assert.deepEqual([paid?.token, paid?.into], ['SOL', 'USDC']);
  });

  test('stopping between steps says what the money waits in', () => {
    const told = settledOf(
      { ...request, action: 'move', fromToken: 'USDS', fromPool: 'Keel Flagship USDS' },
      {
        ok: true,
        signature: '5xy',
        landed: 'landed',
        halfway: true,
        holding: 'USDS',
        error: 'User rejected the request.',
      },
    );
    assert.equal(told?.halfway, true);
    assert.equal(told?.holding, 'USDS');
    assert.equal(told?.token, 'USDS');
  });

  test('a rejection carries the reason the chain gave', () => {
    const told = settledOf(request, {
      ok: true,
      signature: '5xy',
      landed: 'failed',
      error: 'insufficient funds',
    });
    assert.equal(told?.status, 'failed');
    assert.equal(told?.error, 'insufficient funds');
  });

  test('one still in the air is not called landed', () => {
    assert.equal(settledOf(request, { ok: true, signature: '5xy', landed: 'pending' })?.status, 'sent');
    assert.equal(settledOf(request, { ok: true, signature: '5xy' })?.status, 'sent');
  });

  test('nothing is told when nothing was signed', () => {
    assert.equal(settledOf(request, { ok: false, reason: 'cancelled' }), null);
    assert.equal(settledOf(request, undefined), null);
    assert.equal(settledOf(request, { ok: true }), null, 'a deposit with no signature is not news');
  });
});

describe('WhenTheDepositNeverReachedTheWallet', () => {
  const request: DepositRequest = {
    poolId: 'sol:kamino:vault:AAA',
    pool: 'Elemental USDC Turbo',
    protocol: 'kamino',
    poolKind: 'vault',
    network: 'sol',
    token: 'USDC',
    amount: '12.0014',
  };

  test('a build the server would not make is told, with its reason', () => {
    const told = settledOf(request, {
      ok: false,
      at: 'build',
      reason: 'this deposit needs 0.0053 SOL for rent and this wallet has 0.0015 SOL',
    });
    assert.equal(told?.status, 'refused');
    assert.equal(told?.signature, null);
    assert.match(told?.error ?? '', /0\.0053 SOL/);
  });

  test('a wallet somebody closed is not news', () => {
    assert.equal(settledOf(request, { ok: false, at: 'wallet', reason: 'User rejected' }), null);
    assert.equal(settledOf(request, { ok: false, at: 'cancelled', reason: 'cancelled' }), null);
    assert.equal(settledOf(request, { ok: false, at: 'connect', reason: 'locked' }), null);
  });
});

describe('ALiquidityCard', () => {
  const lp: DepositBlock = {
    kind: 'deposit',
    action: 'provide',
    poolId: 'sol:meteora:dlmm:CgqwPL',
    pool: 'SOL-USDC',
    protocol: 'meteora',
    poolKind: 'dlmm',
    network: 'sol',
    token: 'USDC',
    amount: '5',
    apy: '19.96%',
    risk: 'medium',
    url: 'https://app.meteora.ag/dlmm/CgqwPL',
    payWith: { mint: 'EPjF', symbol: 'USDC' },
    belowPct: '10.3',
    abovePct: '5.5',
    lowerPrice: '105.17',
    upperPrice: '123.70',
    price: '117.25',
  };

  test('says what goes in and where, and the range with the prices it reaches', () => {
    assert.equal(sizeOf(lp), '5 USDC → SOL-USDC');
    assert.equal(rangeOf(lp), '105.17 – 123.70 · −10.3% / +5.5%');
  });

  test('promises fees only in range, and says the rent comes back', () => {
    assert.match(promiseOf(lp), /only while the price stays in the range/);
    assert.match(promiseOf(lp), /0\.057 SOL as rent, returned/);
  });

  test('a card a strategy put up is told back as its, with the position it acted on', () => {
    const request = requestOf({ ...lp, action: 'rebalance', position: 'Def4KL', strategy: 'lpdown' });
    assert.deepEqual(settledOf(request, { ok: true, signature: '5xy', landed: 'landed' }), {
      amount: '5',
      token: 'USDC',
      pool: 'SOL-USDC',
      action: 'rebalance',
      from_pool: null,
      strategy: 'lpdown',
      position: 'Def4KL',
      status: 'landed',
      signature: '5xy',
      error: null,
    });
  });

  test('hands the host the range and the coin to build it with', () => {
    const request = requestOf(lp);
    assert.equal(request.action, 'provide');
    assert.equal(request.belowPct, '10.3');
    assert.equal(request.abovePct, '5.5');
    assert.deepEqual(request.payWith, { mint: 'EPjF', symbol: 'USDC' });
  });

  test('out of a lending pool, it says where the money comes out of and hands that over', () => {
    const fromPrime = {
      ...lp,
      amount: 'all',
      shown: '12.008636',
      fromPoolId: 'sol:kamino:vault:9E69',
      fromPool: 'USDC Prime',
      fromApy: '4.20%',
    };
    assert.equal(sizeOf(fromPrime), '12.008636 USDC → SOL-USDC');
    assert.match(promiseOf(fromPrime), /^It comes out of USDC Prime first\./);
    const request = requestOf(fromPrime);
    assert.equal(request.fromPoolId, 'sol:kamino:vault:9E69');
    assert.equal(request.amount, 'all');
  });

  test('a rebalance names the position and what it holds', () => {
    const rebalance = {
      ...lp,
      action: 'rebalance' as const,
      position: '8PBf2k',
      shown: '$12.16',
      belowPct: '5',
      abovePct: '5',
    };
    assert.equal(sizeOf(rebalance), '$12.16 in SOL-USDC');
    assert.equal(requestOf(rebalance).position, '8PBf2k');
  });
});

describe('ASwapCard', () => {
  const swap: DepositBlock = {
    kind: 'deposit',
    action: 'swap',
    poolId: '',
    pool: 'xBTC to USDC',
    protocol: 'kamino',
    poolKind: 'swap',
    network: 'sol',
    token: 'xBTC',
    amount: 'all',
    shown: '5.311297',
    apy: '',
    risk: '',
    url: '',
    payWith: { mint: 'CtzP', symbol: 'xBTC' },
    receiveAs: { mint: 'EPjF', symbol: 'USDC' },
  };

  test('says what it gives and what it gets', () => {
    assert.equal(sizeOf(swap), '5.311297 xBTC → USDC');
    assert.equal(
      promiseOf(swap),
      'It is a trade, and the money stays in your wallet. xBTC becomes USDC, and your wallet may ask you to sign more than once. Nothing moves until you sign.',
    );
  });

  test('hands the host both coins, which is all a swap is built from', () => {
    const request = requestOf(swap);
    assert.equal(request.action, 'swap');
    assert.equal(request.amount, 'all');
    assert.deepEqual(request.payWith, { mint: 'CtzP', symbol: 'xBTC' });
    assert.deepEqual(request.receiveAs, { mint: 'EPjF', symbol: 'USDC' });
  });

  test('is told back as a swap, in what left and what it became', () => {
    const told = settledOf(requestOf(swap), { ok: true, signature: '5xy', landed: 'landed' });
    assert.deepEqual([told?.action, told?.token, told?.into], ['swap', 'xBTC', 'USDC']);
  });
});

describe('AFlowThatStoppedHalfway', () => {
  test('is not called landed, and says where the money is', () => {
    const shown = afterDeposit({
      ok: true,
      signature: '5xy',
      landed: 'landed',
      halfway: true,
      holding: 'xBTC',
      error: 'the next step could not be prepared',
    });
    assert.equal(shown.state, 'halfway');
    assert.equal(
      shown.note,
      'the next step did not go through (the next step could not be prepared); the money is in your wallet as xBTC',
    );
    assert.equal(shown.signature, '5xy');
  });
});
