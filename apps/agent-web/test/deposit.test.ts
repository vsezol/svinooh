import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { afterDeposit, requestOf } from '../src/components/blocks/DepositBlock';
import type { DepositBlock } from '../src/app/types';

const card: DepositBlock = {
  kind: 'deposit',
  poolId: 'sol:kamino:vault:AAA',
  pool: 'Steakhouse USDC',
  protocol: 'kamino',
  network: 'sol',
  token: 'USDC',
  amount: '250',
  apy: '5.12%',
  risk: 'low',
  url: 'https://kamino.finance/earn/lend/AAA',
  accounts: { programId: 'KLend', address: 'AAA', tokenMint: 'EPjF', tokenDecimals: 6 },
};

describe('WhatTheHostIsHandedAndWhatComesBack', () => {
  test('the host is handed what it needs to build the deposit, and no more', () => {
    assert.deepEqual(requestOf(card), {
      poolId: card.poolId,
      pool: card.pool,
      protocol: card.protocol,
      network: card.network,
      token: card.token,
      amount: card.amount,
      accounts: card.accounts,
    });
  });

  test('a refusal keeps its reason', () => {
    assert.deepEqual(afterDeposit({ ok: false, reason: 'user rejected it' }), {
      state: 'refused',
      note: 'user rejected it',
    });
  });

  test('a signature is shown when there is one', () => {
    assert.deepEqual(afterDeposit({ ok: true, signature: '5xy' }), { state: 'signed', note: '5xy' });
  });

  test('a host that answers nothing is still an answer', () => {
    assert.deepEqual(afterDeposit(undefined), { state: 'signed', note: null });
  });
});
