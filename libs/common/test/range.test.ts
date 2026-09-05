import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import type { DefiFacts, LendingFact, PoolFact, ScanPosition, ScanPositionToken } from '@svinooh/shared';
import { hasRange, rangeFromLegs } from '../src/range';
import { enrich } from '../src/defi-facts';

const leg = (symbol: string, role: ScanPositionToken['role'], valueUsd: number): ScanPositionToken =>
  ({ symbol, amount: 1, priceUsd: valueUsd, valueUsd, role }) as ScanPositionToken;

const pool = (over: Partial<PoolFact>): PoolFact =>
  ({
    id: 'uniswap:base:1',
    platform: 'uniswap',
    pair: 'USDC|WETH',
    pairLabel: 'USDC/WETH',
    feePct: 0.05,
    chainLabel: 'Base',
    inRange: true,
    lowerPrice: 2000,
    upperPrice: 3000,
    currentPrice: 2451,
    priceLabel: 'USDC per WETH',
    isFullRange: false,
    ...over,
  }) as PoolFact;

const position = (over: Partial<ScanPosition>): ScanPosition =>
  ({ symbol: 'Uniswap V3', name: 'Liquidity Pool', valueUsd: 100, tokens: [], ...over }) as ScanPosition;

describe('rangeFromLegs', () => {
  test('both sides held — in range', () => {
    assert.equal(rangeFromLegs([leg('USDC', 'supply', 500), leg('WETH', 'supply', 500)]), 'in');
  });

  test('one side worn down to almost nothing — out', () => {
    assert.equal(rangeFromLegs([leg('USDC', 'supply', 1000), leg('WETH', 'supply', 1)]), 'out');
  });

  /**
   * The case that took the badge off the screen. A position that has crossed a
   * bound is converted whole into one token, and a source reporting it reports
   * ONE leg — not two with a zero. The old guard read that as "not a pair" and
   * gave up, which is the one state the function is definitionally able to
   * answer for.
   */
  test('converted entirely to one side — out, not silence', () => {
    assert.equal(rangeFromLegs([leg('USDC', 'supply', 10_000)]), 'out');
  });

  test('fees on both sides do not make a single-sided position two-sided', () => {
    assert.equal(
      rangeFromLegs([leg('USDC', 'supply', 10_000), leg('USDC', 'reward', 76), leg('WETH', 'reward', 76)]),
      'out',
    );
  });

  test('nothing to go on stays silent', () => {
    assert.equal(rangeFromLegs([]), null);
    assert.equal(rangeFromLegs([leg('USDC', 'reward', 5)]), null);
  });
});

/**
 * The check the old `supplied.length !== 2` guard was doing by accident. When
 * the single-legged case became answerable, everything that holds one asset
 * because that is simply what it is started answering "out of range" — Venus,
 * Aave, Karak, Hyperliquid, Polygon Staking. On a lending position that is not
 * a small wrongness: it is a sentence about liquidation risk, said where the
 * words mean nothing.
 */
describe('hasRange — which kinds have a range at all', () => {
  test('pools do', () => {
    for (const kind of ['Liquidity Pool', 'LP', 'Concentrated Liquidity', 'liquidity pool'])
      assert.equal(hasRange(kind), true, kind);
  });

  test('everything that holds one asset by nature does not', () => {
    for (const kind of ['Lending', 'Staked', 'Deposit', 'Yield', 'Farming', 'Locked', 'Vesting', 'Rewards'])
      assert.equal(hasRange(kind), false, kind);
  });

  test('an unnamed kind is not assumed to be a pool', () => {
    assert.equal(hasRange(null), false);
    assert.equal(hasRange(''), false);
  });
});

describe('enrich — finding the pool a position belongs to', () => {
  const facts = (pools: PoolFact[]): DefiFacts => ({ pools, lending: [] }) as DefiFacts;

  /**
   * A lending position supplying one asset and earning a reward in another has
   * two symbols on it, and they are not a pair. Without the kind check it
   * matched a pool fact and was handed somebody else's band.
   */
  test('a loan earning a reward in another token is not a pair', () => {
    const [p] = enrich(
      [
        position({
          name: 'Lending',
          tokens: [leg('USDC', 'supply', 10_000), leg('WETH', 'reward', 12)],
        }),
      ],
      facts([pool({})]),
    );
    assert.equal(p.band, undefined);
    assert.equal(p.range, undefined);
  });

  test('a two-sided position finds its pool, as it always did', () => {
    const [p] = enrich(
      [position({ tokens: [leg('USDC', 'supply', 500), leg('WETH', 'supply', 500)] })],
      facts([pool({})]),
    );
    assert.equal(p.range, 'in');
    assert.equal(p.band?.lower, 2000);
  });

  /**
   * One token held, both tokens in the uncollected fees. The pair cannot be
   * read off what the position is holding any more, and reading it off the
   * fees is how the band comes back for exactly the positions that have left
   * their range.
   */
  test('a one-sided position finds its pool through its fees', () => {
    const [p] = enrich(
      [
        position({
          tokens: [leg('USDC', 'supply', 10_000), leg('USDC', 'reward', 76), leg('WETH', 'reward', 76)],
        }),
      ],
      facts([pool({ inRange: false })]),
    );
    assert.equal(p.range, 'out');
    assert.equal(p.band?.upper, 3000);
  });

  /**
   * Two positions in one pool: the screenshot that started this. The pair is
   * the same for both, so the pair alone can only shrug — and used to, leaving
   * both without a band. Each names itself, and so does each fact.
   */
  test('two positions in one pool are told apart by their ids', () => {
    const enriched = enrich(
      [
        position({ ref: '5854873', tokens: [leg('USDC', 'supply', 10_000)] }),
        position({ ref: '5854867', tokens: [leg('USDC', 'supply', 4_404)] }),
      ],
      facts([
        pool({ id: 'uniswap:base:5854873', ref: '5854873', lowerPrice: 2000, upperPrice: 3000 }),
        pool({ id: 'uniswap:base:5854867', ref: '5854867', lowerPrice: 1500, upperPrice: 2500 }),
      ]),
    );
    assert.equal(enriched[0].band?.lower, 2000);
    assert.equal(enriched[1].band?.lower, 1500);
  });

  /**
   * The narrowing can only ever resolve an ambiguity. If the two sides turn out
   * not to name positions the same way, this lands exactly where it did before
   * — no band rather than the wrong one.
   */
  test('ids that do not line up leave the old behaviour alone', () => {
    const enriched = enrich(
      [position({ ref: 'debank-7', tokens: [leg('USDC', 'supply', 10_000)] })],
      facts([pool({ ref: '5854873' }), pool({ id: 'uniswap:base:2', ref: '5854867' })]),
    );
    assert.equal(enriched[0].band, undefined);
    assert.equal(enriched[0].range, undefined);
  });

  test('a wallet with one position per pair never needed an id', () => {
    const [p] = enrich(
      [position({ tokens: [leg('USDC', 'supply', 10_000), leg('WETH', 'reward', 76)] })],
      facts([pool({ ref: null, inRange: false })]),
    );
    assert.equal(p.band?.pair, 'USDC/WETH');
    assert.equal(p.range, 'out');
  });

  /**
   * Where this still cannot help, stated rather than papered over: a position
   * converted to one token, with its fees already collected and no id on
   * either side, has nothing left that names the other half of its pair. It
   * keeps the badge — a single-sided position is out of range by definition,
   * which needs no pool to know — and goes without the bar.
   */
  test('one token, no fees, no id — the badge still, the band honestly not', () => {
    const [p] = enrich(
      [position({ tokens: [leg('USDC', 'supply', 10_000)] })],
      facts([pool({ ref: null, inRange: false })]),
    );
    assert.equal(p.band, undefined);
    assert.equal(rangeFromLegs([leg('USDC', 'supply', 10_000)]), 'out');
  });
});


describe('enrich — what a loan costs is the lending protocol\'s own number', () => {
  const loanFact = (over: Partial<LendingFact> = {}): LendingFact =>
    ({
      id: 'kamino:market:reserve',
      platform: 'kamino',
      market: 'SOL/BTC Market',
      token: 'USDT',
      healthFactor: 2.5,
      borrowRate: 5.01,
      ...over,
    }) as LendingFact;
  const facts = (lending: LendingFact[]): DefiFacts => ({ pools: [], lending }) as DefiFacts;

  /**
   * The wild-caught case: Jupiter priced a Kamino USDT loan at 7.8% APR
   * (stored as ~8.1% effective) while Kamino's own API, the owner's day of
   * accrued interest and Kamino's own interface all said 5.0%. The protocol's
   * rate replaces the aggregator's — on the position AND on the borrowed leg,
   * which is what the visible "USDT · 8.1%" was printed from.
   */
  test('the protocol rate replaces the aggregator rate, leg included', () => {
    const [p] = enrich(
      [
        position({
          name: 'Lending',
          borrowApy: 0.0807,
          healthRate: 2.51,
          tokens: [
            leg('cbBTC', 'supply', 8_600),
            { ...leg('USDT', 'borrow', -3_000), apy: 0.0807 },
          ],
        }),
      ],
      facts([loanFact()]),
    );
    assert.equal(p.borrowApy, 0.0501);
    const borrowLeg = (p.tokens ?? []).find((t) => t.role === 'borrow')!;
    assert.equal(borrowLeg.apy, 0.0501);
    // the aggregator's health survives — it was present, and the fact only fills
    assert.equal(p.healthRate, 2.51);
    // and the supply leg is nobody's loan
    assert.equal((p.tokens ?? []).find((t) => t.role === 'supply')!.apy, undefined);
  });

  test('no matching fact leaves the aggregator rate alone', () => {
    const [p] = enrich(
      [position({ name: 'Lending', borrowApy: 0.0807, tokens: [{ ...leg('USDC', 'borrow', -100), apy: 0.0807 }] })],
      facts([loanFact()]), // fact is about USDT, position borrows USDC
    );
    assert.equal(p.borrowApy, 0.0807);
  });

  test('two facts about the same token cannot pick a side', () => {
    const [p] = enrich(
      [position({ name: 'Lending', borrowApy: 0.0807, tokens: [leg('USDT', 'borrow', -100)] })],
      facts([loanFact(), loanFact({ id: 'kamino:other:reserve', market: 'Main Market', borrowRate: 9.9 })]),
    );
    assert.equal(p.borrowApy, 0.0807);
  });

  test('a fact with no rate still names the market and touches nothing else', () => {
    const [p] = enrich(
      [position({ name: 'Lending', borrowApy: 0.0807, tokens: [leg('USDT', 'borrow', -100)] })],
      facts([loanFact({ borrowRate: null })]),
    );
    assert.equal(p.borrowApy, 0.0807);
    assert.equal(p.loan?.market, 'SOL/BTC Market');
  });
});
