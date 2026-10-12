import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { PositionDto } from '@svinooh/shared';
import { buildBlocks } from '../src/lib/blocks';
import { rebalanceable, rebalanceQuestion } from '../src/lib/rebalance';

const band = {
  pair: 'SOL/USDC',
  feePct: 0.04,
  chainLabel: 'Solana',
  lower: 75.05,
  upper: 110.42,
  current: 120.3,
  priceLabel: 'USDC per SOL',
};

const meteora = (over: Partial<PositionDto>): PositionDto => ({
  id: 'p-1',
  key: 'p-1',
  symbol: 'Meteora',
  name: 'Liquidity Pool',
  note: 'SOL/USDC',
  category: 'defi',
  valueUsd: 1500,
  range: 'out',
  band,
  tokens: [{ symbol: 'USDC', role: 'supply', valueUsd: 1500, amount: 1500 }],
  ...over,
});

const block = (over: Partial<PositionDto>) => buildBlocks([meteora(over)])[0];

describe('APositionsRebalanceButton', () => {
  test('asks what the Telegram alert asks', () => {
    assert.equal(
      rebalanceQuestion(band),
      'Rebalance my Meteora SOL/USDC position that went out of range (75.05 - 110.42 USDC per SOL): ' +
        'close it and place it again around the current price, keeping its width.',
    );
  });

  test('is there for a Meteora position that left its range', () => {
    assert.equal(rebalanceable(block({})), true);
  });

  test('and not for one in range, one of another protocol, or one with no band to name', () => {
    assert.equal(rebalanceable(block({ range: 'in' })), false);
    assert.equal(rebalanceable(block({ symbol: 'Orca' })), false);
    assert.equal(rebalanceable(block({ band: null })), false);
  });
});
