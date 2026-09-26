import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, describe, test } from 'node:test';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { AppModule } from '../src/app.module';
import { ProblemFilter } from '../src/api/problems';
import type { LandingStatus } from '../src/domain/deposit';
import {
  coinsMoved,
  FRESH_FOR_S,
  isFresh,
  NATIVE_SOL,
  poolsTouched,
  sharesMints,
  type Effects,
  type TokenBalance,
} from '../src/domain/effects';
import type { PairPool } from '../src/domain/liquidity';
import { KaminoApi } from '../src/infrastructure/kamino/api';
import { KaminoSource } from '../src/infrastructure/kamino/source';
import { settingsFromEnv } from '../src/settings';
import { RecordedKamino } from './fixtures/kamino';
import { pool } from './support';

const OWNER = '5Hb8BfQVmvEhaKsoXBV2g3EExoqTCKsVNXrGsrbadHJS';
const SOMEBODY = 'DmDy7wmeMBNM6wsJsD7jt79TCjQiCJguMDVKrvHXwzu5';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const CBBTC = 'cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij';
const SHARES = '9YHNzyKwsdZ54GirTp6wSMweL9twT6sxF9RJPeE6aXem';
const SIGNATURE =
  '5NAYRQL9AjsnThsMeuwP4TojDDN4e5oKonmkWNogwU4SFcaYptN76dB4mVnwWaJSfeor1kTyWiqNa3ogNw7h3Wdu';

const held = (mint: string, amount: string, owner = OWNER): TokenBalance => ({
  mint,
  owner,
  amount,
  decimals: 6,
});

const figures = (moved: ReturnType<typeof coinsMoved>) =>
  moved.map((one) => [one.mint, one.amount.toFixed()]);

describe('WhatATransactionMovedInTheWallet', () => {
  test('a coin whose balance changed comes back at what it is now, and SOL always does', () => {
    const moved = coinsMoved(OWNER, [held(USDC, '0')], [held(USDC, '12007640')], 106297173n);
    assert.deepEqual(figures(moved), [
      [NATIVE_SOL, '0.106297173'],
      [USDC, '12.00764'],
    ]);
  });

  test('an account the transaction closed is a balance of nothing', () => {
    const moved = coinsMoved(OWNER, [held(USDC, '6312239')], [], 62747282n);
    assert.deepEqual(figures(moved), [
      [NATIVE_SOL, '0.062747282'],
      [USDC, '0'],
    ]);
  });

  test('an account opened empty, and money of somebody else, are not this wallet moving', () => {
    const moved = coinsMoved(
      OWNER,
      [held(USDC, '100', SOMEBODY)],
      [held(CBBTC, '0'), held(USDC, '900', SOMEBODY)],
      1n,
    );
    assert.deepEqual(figures(moved), [[NATIVE_SOL, '0.000000001']]);
  });

  test('two accounts of one coin are one balance', () => {
    const moved = coinsMoved(
      OWNER,
      [held(USDC, '1000000')],
      [held(USDC, '1000000'), held(USDC, '2500000')],
      0n,
    );
    assert.deepEqual(figures(moved), [
      [NATIVE_SOL, '0'],
      [USDC, '3.5'],
    ]);
  });
});

describe('WhichTransactionsAreWorthReadingAgain', () => {
  const now = new Date('2026-09-25T08:20:00Z');
  const secondsAgo = (seconds: number) => now.getTime() / 1000 - seconds;

  test('one that landed a moment ago', () => {
    assert.equal(isFresh(secondsAgo(5), now), true);
  });

  test('not one from long ago, whose balances are long gone', () => {
    assert.equal(isFresh(secondsAgo(FRESH_FOR_S + 1), now), false);
  });

  test('not one whose time the chain did not say', () => {
    assert.equal(isFresh(null, now), false);
  });
});

describe('WhichPoolsATransactionTouched', () => {
  const vault = pool({
    address: 'VAULT',
    deposit: { ...pool().deposit, address: 'VAULT', sharesMint: SHARES, farm: 'FARM' },
  });
  const reserve = pool({
    address: 'RESERVE',
    id: { network: 'sol', protocol: 'kamino', kind: 'reserve', address: 'RESERVE' },
  });

  test('a vault is read again, and the reserves it lends through are its own business', () => {
    const touched = poolsTouched([vault, reserve], new Set(['VAULT', 'RESERVE', 'OTHER']));
    assert.deepEqual(touched.vaults, [vault]);
    assert.deepEqual(touched.unreadable, []);
  });

  test('a reserve on its own is a position nothing here reads again yet', () => {
    const touched = poolsTouched([vault, reserve], new Set(['RESERVE']));
    assert.deepEqual(touched.vaults, []);
    assert.deepEqual(touched.unreadable, [reserve]);
  });

  test('a vault with no shares mint cannot be read', () => {
    const blind = pool({ address: 'BLIND' });
    const touched = poolsTouched([vault, blind], new Set(['VAULT', 'BLIND']));
    assert.deepEqual(touched.unreadable, [blind]);
  });

  test('the shares of a vault are the vault, never a coin in the wallet', () => {
    assert.deepEqual([...sharesMints([vault, reserve])], [SHARES]);
  });
});

const PAIR: PairPool = {
  id: { network: 'sol', protocol: 'meteora', kind: 'dlmm', address: 'BVRbyL' },
  name: 'SOL-USDC',
  x: { symbol: 'SOL', mint: 'So11111111111111111111111111111111111111112', decimals: 9, verified: true },
  y: { symbol: 'USDC', mint: USDC, decimals: 6, verified: true },
  binStep: 20,
  baseFeePct: new Decimal('0.2'),
  tvlUsd: new Decimal('2004920'),
  volume24hUsd: new Decimal('1266160'),
  fees24hUsd: new Decimal('2035'),
  price: new Decimal('116.968'),
  url: 'https://app.meteora.ag/dlmm/BVRbyL',
};

describe('WhatALandingLeftBehind', () => {
  let app: INestApplication;
  let base: string;
  let status: LandingStatus = 'landed';
  let asked: { signature: string; owner: string; pools: number } | null = null;

  before(async () => {
    app = await NestFactory.create(
      AppModule.with({
        settings: { ...settingsFromEnv(), startupGraceMs: 5000, refreshIntervalMs: 600_000 },
        sources: [new KaminoSource(new KaminoApi(new RecordedKamino()))],
        landings: { sol: async (signature) => ({ signature, status, slot: 42, error: null }) },
        effects: {
          sol: async (signature, owner, pools): Promise<Effects> => {
            asked = { signature, owner, pools: pools.length };
            const vault = pools.find((one) => one.id.kind === 'vault')!;
            return {
              slot: 371_802_114,
              coins: [
                {
                  mint: NATIVE_SOL,
                  symbol: 'SOL',
                  amount: new Decimal('0.106297173'),
                  priceUsd: new Decimal('117.16'),
                },
                { mint: USDC, symbol: 'USDC', amount: new Decimal('12.00764'), priceUsd: null },
              ],
              vaults: [{ pool: vault, amount: new Decimal(0), priceUsd: new Decimal('0.9999') }],
              pairs: [
                {
                  pool: PAIR,
                  priceX: new Decimal('117.14'),
                  priceY: new Decimal('0.9999'),
                  positions: [
                    {
                      address: '955Jz',
                      pool: PAIR,
                      lowerPrice: new Decimal('110.825218'),
                      upperPrice: new Decimal('122.7135139'),
                      inRange: true,
                      amountX: new Decimal('0.046605273'),
                      amountY: new Decimal('6.541655'),
                      valueUsd: new Decimal('12.0009'),
                      feesUsd: new Decimal('0.0008'),
                    },
                  ],
                  touched: ['955Jz'],
                },
              ],
            };
          },
        },
      }),
      { logger: false },
    );
    app.useGlobalFilters(new ProblemFilter());
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  after(async () => {
    await app.close();
  });

  const read = async (query: string) => {
    const answered = await fetch(`${base}/v1/lend/deposits/${SIGNATURE}/effects?${query}`);
    return { status: answered.status, body: (await answered.json()) as any };
  };

  test('the wallet as the chain has it now, and every vault and pair the transaction touched', async () => {
    status = 'landed';
    const { status: code, body } = await read(`network=sol&owner=${OWNER}`);
    assert.equal(code, 200);
    assert.deepEqual(asked && { signature: asked.signature, owner: asked.owner }, {
      signature: SIGNATURE,
      owner: OWNER,
    });
    assert.ok(asked!.pools > 0, 'the whole catalog is offered to find the vaults in');
    assert.equal(body.data.slot, 371_802_114);
    assert.deepEqual(body.data.coins, [
      { mint: NATIVE_SOL, symbol: 'SOL', amount: '0.106297173', price_usd: '117.16' },
      { mint: USDC, symbol: 'USDC', amount: '12.00764', price_usd: null },
    ]);
    const [vault] = body.data.vaults;
    assert.equal(vault.amount, '0');
    assert.match(vault.pool_id, /^sol:kamino:vault:/);
    assert.ok('farm' in vault && 'shares_mint' in vault);
    const [pair] = body.data.pairs;
    assert.equal(pair.pool.id, 'sol:meteora:dlmm:BVRbyL');
    assert.equal(pair.price_x_usd, '117.14');
    assert.deepEqual(pair.positions[0], {
      address: '955Jz',
      lower_price: '110.825218',
      upper_price: '122.7135139',
      in_range: true,
      amount_x: '0.046605273',
      amount_y: '6.541655',
      value_usd: '12.00',
      fees_usd: '0.00',
      touched: true,
    });
  });

  test('a transaction that has not landed has left nothing yet', async () => {
    status = 'pending';
    asked = null;
    const { status: code, body } = await read(`network=sol&owner=${OWNER}`);
    assert.equal(code, 200);
    assert.equal(body.data, null);
    assert.equal(asked, null);
  });

  test('whose wallet it was has to be said', async () => {
    const { status: code, body } = await read('network=sol');
    assert.equal(code, 422);
    assert.match(body.detail, /^owner:/);
  });
});
