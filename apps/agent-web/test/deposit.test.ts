import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { afterDeposit, requestOf } from '../src/components/blocks/DepositBlock';
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
    });
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
