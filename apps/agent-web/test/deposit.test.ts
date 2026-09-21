import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import {
  afterDeposit,
  promiseOf,
  requestOf,
  settledOf,
  sizeOf,
} from '../src/components/blocks/DepositBlock';
import type { DepositRequest } from '../src/app/types';
import type { DepositBlock } from '../src/app/types';

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
    const told = settledOf(
      { ...card, action: 'move', amount: 'all' } as never,
      { ok: true, signature: '5xy', landed: 'landed', halfway: true, error: 'User rejected the request.' },
    );
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
      { ...request, action: 'withdraw', token: 'SOL', amount: '0.1', receiveAs: { mint: 'EPjF', symbol: 'USDC' } },
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
      { ok: true, signature: '5xy', landed: 'landed', halfway: true, holding: 'USDS', error: 'User rejected the request.' },
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
