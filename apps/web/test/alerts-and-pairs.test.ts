import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { PositionDto } from '@svinooh/shared';
import { cleanThreshold, parseThreshold } from '../src/lib/alerts';
import { buildBlocks } from '../src/lib/blocks';

/** What the field actually does to a keystroke, end to end */
const typed = (raw: string): number | null => parseThreshold(cleanThreshold(raw));

describe('WhatAThresholdAccepts', () => {
  test('a comma is a decimal point, not a character to delete', () => {
    // The bug this is here for: the comma was stripped, so "0,5" became 5 and
    // "5,5" became 55 — a threshold ten times the one that was meant, saved
    // without a word
    assert.equal(typed('0,5'), 0.5);
    assert.equal(typed('5,5'), 5.5);
    assert.equal(typed('1,05'), 1.05);
  });

  test('a point still works, and so does a whole number', () => {
    assert.equal(typed('0.5'), 0.5);
    assert.equal(typed('8.05'), 8.05);
    assert.equal(typed('6'), 6);
  });

  test('a second separator is dropped rather than turning the field to NaN', () => {
    assert.equal(typed('8.0.5'), 8.05);
    assert.equal(typed('5,,5'), 5.5);
  });

  test('nothing to watch is empty, not zero', () => {
    assert.equal(typed(''), null);
    assert.equal(typed('abc'), null);
    assert.equal(typed('0'), null);
  });
});

const lp = (over: Partial<PositionDto>): PositionDto => ({
  id: 'p-1',
  key: 'p-1',
  symbol: 'Uniswap V3',
  name: 'Liquidity Pool',
  note: '#6051653',
  category: 'defi',
  valueUsd: 4900,
  ...over,
});

const band = {
  pair: 'cbBTC/USDC',
  feePct: 0.05,
  chainLabel: 'Base',
  lower: 1,
  upper: 2,
  current: 3,
  priceLabel: 'USDC per cbBTC',
};

describe('WhatAPoolSaysItIsMadeOf', () => {
  test('the pair comes from the band, which an out-of-range position still has', () => {
    // The position on screen holds nothing but USDC — the price left the range
    // — so its own table cannot say what pair it is
    const [block] = buildBlocks([
      lp({ band, range: 'out', tokens: [{ symbol: 'USDC', role: 'supply', valueUsd: 4900, amount: 4900 }] }),
    ]);
    assert.equal(block.pair, 'cbBTC/USDC');
  });

  test('without a band, two supplied legs are the pair', () => {
    const [block] = buildBlocks([
      lp({
        note: '#2974893',
        tokens: [
          { symbol: 'USDT0', role: 'supply', valueUsd: 4110, amount: 4110 },
          { symbol: 'WETH', role: 'supply', valueUsd: 287, amount: 0.109 },
        ],
      }),
    ]);
    assert.equal(block.pair, 'USDT0/WETH');
  });

  test('one leg, or three, is not a pair and is not named as one', () => {
    const [one] = buildBlocks([
      lp({ tokens: [{ symbol: 'USDC', role: 'supply', valueUsd: 4900, amount: 4900 }] }),
    ]);
    assert.equal(one.pair, null);
  });

  test('a lending position is not a pool and gets no pair', () => {
    const [block] = buildBlocks([
      lp({
        symbol: 'Aave V3',
        name: 'Lending',
        healthRate: 1.4,
        tokens: [
          { symbol: 'WETH', role: 'supply', valueUsd: 10000, amount: 3.8 },
          { symbol: 'USDC', role: 'borrow', valueUsd: -4000, amount: -4000 },
        ],
      }),
    ]);
    assert.equal(block.pair, null);
  });
});

describe('APositionWithARangeOrALoanIsItsOwnCard', () => {
  const legs = [
    { symbol: 'cbBTC', role: 'supply' as const, valueUsd: 2400, amount: 0.02 },
    { symbol: 'USDC', role: 'supply' as const, valueUsd: 2500, amount: 2500 },
  ];

  test('two ranges in one pool are two cards, each with its own badge', () => {
    const blocks = buildBlocks([
      lp({ id: 'a', note: null, band, range: 'in', tokens: legs }),
      lp({ id: 'b', note: null, band: { ...band, lower: 0.5 }, range: 'out', tokens: legs }),
    ]);
    assert.deepEqual(
      blocks.map((block) => [block.count, block.range]),
      [
        [1, 'in'],
        [1, 'out'],
      ],
    );
  });

  test('two loans alike in every leg are two cards, each with its own health', () => {
    const loan = (id: string, healthRate: number) =>
      lp({
        id,
        symbol: 'Kamino',
        name: 'Lending',
        note: 'Main Market',
        healthRate,
        tokens: [
          { symbol: 'SOL', role: 'supply', valueUsd: 900, amount: 5 },
          { symbol: 'USDC', role: 'borrow', valueUsd: -300, amount: -300 },
        ],
      });
    const blocks = buildBlocks([loan('a', 1.2), loan('b', 3.4)]);
    assert.deepEqual(
      blocks.map((block) => block.healthRate),
      [1.2, 3.4],
    );
  });

  test('positions with nothing of the kind still fold into one', () => {
    const farm = (id: string) =>
      lp({
        id,
        symbol: 'Kamino',
        name: 'Farming',
        note: null,
        valueUsd: 3,
        tokens: [{ symbol: 'KMNO', role: 'reward', valueUsd: 3, amount: 80 }],
      });
    const blocks = buildBlocks([farm('a'), farm('b')]);
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].count, 2);
  });
});
