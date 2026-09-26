import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { itemPositions, tokenPosition } from '../src/scanners/debank-portfolio';

/**
 * The range badge, and the one thing that decides it.
 *
 * These two shapes are taken from a production wallet, and they are why this
 * file exists: DeBank describes them with the SAME kind string, so any rule
 * that reads the name gets one of them wrong. A GMX V2 GM market holding a
 * single asset was being reported OUT OF RANGE, in red, which reads as
 * liquidation risk on a position that has no band at all.
 */
const item = (over: Record<string, unknown>) => ({
  name: 'Liquidity Pool',
  stats: { net_usd_value: 523.24 },
  detail: { supply_token_list: [{ symbol: 'WETH', amount: 0.2111, price: 2481.69 }] },
  ...over,
});

const project = (items: Array<Record<string, unknown>>) =>
  ({ id: 'gmx', name: 'GMX V2', chain: 'arb', portfolio_item_list: items }) as never;

describe('a range is only asked of a position that has one', () => {
  test('GMX V2 has no position id, so no range is claimed', () => {
    const [position] = itemPositions(project([item({})]));
    assert.equal(position.name, 'Liquidity Pool');
    assert.equal(position.ref, null);
    assert.equal(position.range, null, 'a GM market has no band to be outside of');
  });

  test('a single-sided GM market is still not out of range', () => {
    // The shape that produced the red badge: one supplied leg and nothing else
    const [position] = itemPositions(project([item({})]));
    assert.equal(position.tokens?.filter((t) => t.role === 'supply').length, 1);
    assert.notEqual(position.range, 'out');
  });

  test('Uniswap V3 carries the NFT id, and keeps its range', () => {
    const [position] = itemPositions(
      project([
        item({
          position_index: '5854867',
          detail: {
            supply_token_list: [
              { symbol: 'USDC', amount: 3845, price: 1 },
              { symbol: 'WETH', amount: 0.22, price: 2481.69 },
            ],
          },
        }),
      ]),
    );
    assert.equal(position.ref, '5854867');
    assert.equal(position.range, 'in');
  });

  test('an id on something that is not a pool still gets no range', () => {
    const [position] = itemPositions(project([item({ name: 'Lending', position_index: '42' })]));
    assert.equal(position.range, null);
  });
});

describe('which position it is', () => {
  test('the pool or market DeBank names it by comes with it', () => {
    const [position] = itemPositions(
      project([item({ name: 'Lending', pool: { id: '0x794a61358d6845594f94dc1db02a252b5b4814ad', chain: 'arb' } })]),
    );
    assert.equal(position.pool, '0x794a61358d6845594f94dc1db02a252b5b4814ad');
  });

  test('and nothing is made up where DeBank names none', () => {
    const [position] = itemPositions(project([item({})]));
    assert.equal(position.pool, null);
  });

  test('a pool DeBank splits by index is one pool per index', () => {
    const [first, second] = itemPositions(
      project([
        item({ name: 'Farming', pool: { id: '0xfarm', chain: 'arb', index: 3 } }),
        item({ name: 'Farming', pool: { id: '0xfarm', chain: 'arb', index: 7 } }),
      ]),
    );
    assert.equal(first.pool, '0xfarm:3');
    assert.equal(second.pool, '0xfarm:7');
  });

  test('a held token is named by its contract', () => {
    const held = tokenPosition({
      id: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
      chain: 'arb',
      symbol: 'USDC',
      amount: 5,
      price: 1,
    });
    assert.equal(held?.ref, '0xaf88d065e77c8cc2239327c5edb3a432268e5831');
  });
});
