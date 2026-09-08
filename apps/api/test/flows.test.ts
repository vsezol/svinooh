import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { classify, toSignedFlows, type StoredTransfer } from '../src/portfolio/flows';

const MINE = '0xaaaa000000000000000000000000000000000001';
const ALSO_MINE = '0xaaaa000000000000000000000000000000000002';
const BINANCE = '0xbbbb000000000000000000000000000000000099';
const AAVE = '0xcccc000000000000000000000000000000000077';

const T0 = Date.parse('2026-09-01T12:00:00.000Z');
const min = (n: number): Date => new Date(T0 + n * 60_000);

const transfer = (over: Partial<StoredTransfer>): StoredTransfer => ({
  chain: 'EVM',
  address: MINE,
  txHash: '0xtx1',
  minedAt: min(0),
  direction: 'out',
  counterparty: BINANCE,
  network: 'eth',
  operation: 'send',
  symbol: 'USDC',
  amount: 5_000,
  priceUsd: 1,
  valueUsd: 5_000,
  ...over,
});

/** A portfolio holding both of "my" addresses */
const perimeter = (addresses: string[] = [MINE, ALSO_MINE]) => ({
  addresses: new Set(addresses.map((a) => `EVM:${a.toLowerCase()}`)),
  walletOf: new Map(addresses.map((a, i) => [`EVM:${a.toLowerCase()}`, `w${i + 1}`])),
});

const WINDOW = 30 * 60_000;

describe('what crosses the portfolio edge', () => {
  test('sending to an exchange is a withdrawal', () => {
    const [flow] = classify([transfer({})], perimeter(), WINDOW);
    assert.equal(flow.direction, 'out');
    assert.equal(flow.usd, 5_000);
    assert.equal(flow.counterparty, BINANCE);
    assert.equal(flow.walletId, 'w1');
  });

  test('receiving from an exchange is a deposit', () => {
    const [flow] = classify(
      [transfer({ direction: 'in', operation: 'receive', counterparty: BINANCE })],
      perimeter(),
      WINDOW,
    );
    assert.equal(flow.direction, 'in');
    assert.equal(flow.usd, 5_000);
  });

  test('a move between two of the portfolio\'s own wallets is nothing', () => {
    const flows = classify([transfer({ counterparty: ALSO_MINE })], perimeter(), WINDOW);
    assert.equal(flows.length, 0);
  });

  test('the same move IS a flow for a portfolio holding only one end', () => {
    const flows = classify([transfer({ counterparty: ALSO_MINE })], perimeter([MINE]), WINDOW);
    assert.equal(flows.length, 1);
    assert.equal(flows[0].direction, 'out');
  });

  test('counterparties match whatever case they arrive in', () => {
    const flows = classify(
      [transfer({ counterparty: ALSO_MINE.toUpperCase() })],
      perimeter(),
      WINDOW,
    );
    assert.equal(flows.length, 0);
  });

  test('a swap is not a flow, in either leg', () => {
    const flows = classify(
      [
        transfer({ operation: 'trade', direction: 'out', symbol: 'USDC' }),
        transfer({ operation: 'trade', direction: 'in', symbol: 'WETH', amount: 1.5 }),
      ],
      perimeter(),
      WINDOW,
    );
    assert.equal(flows.length, 0);
  });

  test('a deposit into a DeFi protocol is not a flow — the position is still ours', () => {
    const flows = classify(
      [transfer({ operation: 'deposit', counterparty: AAVE })],
      perimeter(),
      WINDOW,
    );
    assert.equal(flows.length, 0);
  });

  test('withdrawing from a protocol is not a deposit either', () => {
    const flows = classify(
      [transfer({ operation: 'withdraw', direction: 'in', counterparty: AAVE })],
      perimeter(),
      WINDOW,
    );
    assert.equal(flows.length, 0);
  });

  test('a claimed reward is a gain, not capital put in', () => {
    const flows = classify(
      [transfer({ operation: 'claim', direction: 'in', counterparty: AAVE })],
      perimeter(),
      WINDOW,
    );
    assert.equal(flows.length, 0);
  });

  test('an approval moves nothing', () => {
    const flows = classify([transfer({ operation: 'approve' })], perimeter(), WINDOW);
    assert.equal(flows.length, 0);
  });

  test('an operation whose direction contradicts it is refused rather than guessed', () => {
    // `send` on a row marked `in` is a row we do not understand
    const flows = classify([transfer({ operation: 'send', direction: 'in' })], perimeter(), WINDOW);
    assert.equal(flows.length, 0);
  });
});

describe('several assets in one transaction', () => {
  test('two legs one way are one flow, and their values add up', () => {
    const flows = classify(
      [
        transfer({ symbol: 'USDC', valueUsd: 5_000 }),
        transfer({ symbol: 'WETH', amount: 1, valueUsd: 3_000, priceUsd: 3_000 }),
      ],
      perimeter(),
      WINDOW,
    );
    assert.equal(flows.length, 1);
    assert.equal(flows[0].usd, 8_000);
    assert.deepEqual(
      flows[0].legs.map((l) => l.symbol),
      ['USDC', 'WETH'],
    );
  });

  test('one unpriced leg makes the whole flow unpriced', () => {
    // Netting $5,000 off a chart because the other $50,000 could not be priced
    // is the one direction this must never fail in
    const flows = classify(
      [
        transfer({ symbol: 'USDC', valueUsd: 5_000 }),
        transfer({ symbol: 'SOMETHING', valueUsd: null, priceUsd: null }),
      ],
      perimeter(),
      WINDOW,
    );
    assert.equal(flows.length, 1);
    assert.equal(flows[0].usd, null);
  });

  test('an unpriced flow is left out of the arithmetic entirely', () => {
    const flows = classify([transfer({ valueUsd: null, priceUsd: null })], perimeter(), WINDOW);
    assert.equal(toSignedFlows(flows).length, 0);
  });
});

describe('bridging between your own chains', () => {
  const out = transfer({ txHash: '0xbridge-out', minedAt: min(0), valueUsd: 10_000 });
  const back = transfer({
    txHash: '0xbridge-in',
    address: ALSO_MINE,
    minedAt: min(5),
    direction: 'in',
    operation: 'receive',
    // The counterparty is the bridge at both ends, so the perimeter test cannot
    // see this pair — which is exactly why the value-and-time rule exists
    counterparty: '0xdddd000000000000000000000000000000000055',
    valueUsd: 9_950,
  });

  test('a matching pair inside the window cancels', () => {
    assert.equal(classify([out, back], perimeter(), WINDOW).length, 0);
  });

  test('the same pair outside the window stands as two flows', () => {
    const late = { ...back, minedAt: min(90) };
    assert.equal(classify([out, late], perimeter(), WINDOW).length, 2);
  });

  test('amounts too far apart are two separate movements', () => {
    const different = { ...back, valueUsd: 4_000 };
    assert.equal(classify([out, different], perimeter(), WINDOW).length, 2);
  });

  test('a window of zero switches the rule off', () => {
    assert.equal(classify([out, back], perimeter(), 0).length, 2);
  });

  test('the two sides of one transaction are never a pair', () => {
    // That shape is a swap, and the operation rule has already decided about it
    const sameTx = { ...back, txHash: out.txHash };
    assert.equal(classify([out, sameTx], perimeter(), WINDOW).length, 2);
  });
});

describe('signing for the strategies', () => {
  test('in is positive and out is negative', () => {
    const flows = classify(
      [
        transfer({ txHash: '0xa', valueUsd: 5_000 }),
        transfer({
          txHash: '0xb',
          minedAt: min(120),
          direction: 'in',
          operation: 'receive',
          valueUsd: 2_000,
        }),
      ],
      perimeter(),
      WINDOW,
    );
    const signed = toSignedFlows(flows).sort((a, b) => a.t - b.t);
    assert.deepEqual(
      signed.map((f) => f.usd),
      [-5_000, 2_000],
    );
  });
});
