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
  const facts = (pools: PoolFact[]): DefiFacts => ({ pools, lending: [], failed: [] });

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
   * What the pair alone did on a live wallet. A GMX V2 GM market has no band by
   * design — you deposit into it and there is nothing to be inside or outside
   * of — and it was holding the two tokens of a Uniswap V3 position on another
   * network. It was shown that position's band, in range, with the other
   * network's name printed under it.
   */
  test('a fact is never handed to a position of another protocol', () => {
    const [p] = enrich(
      [
        position({
          symbol: 'GMX V2',
          platform: 'arb_gmx2',
          network: 'arb',
          tokens: [leg('WETH', 'supply', 900), leg('USDC', 'supply', 900)],
        }),
      ],
      facts([pool({ ref: null })]),
    );
    assert.equal(p.band, undefined);
    assert.equal(p.range, undefined);
  });

  /**
   * The id belongs to the fact as much as to the position. A fact that names
   * the position it was read from is only ever given to the position that names
   * it back; another row in the same pair, whose source named no id at all, is
   * not that position.
   */
  test('a fact that names its position is not given to one that cannot name it back', () => {
    const [p] = enrich(
      [position({ tokens: [leg('USDC', 'supply', 500), leg('WETH', 'supply', 500)] })],
      facts([pool({ ref: '5854873' })]),
    );
    assert.equal(p.band, undefined);
    assert.equal(p.range, undefined);
  });

  /**
   * A fact with no id to give, and a position with no id or pool to meet it
   * by, still find each other by the pair — the protocol's own pair.
   */
  test('a protocol with no id to give still finds its pool by pair', () => {
    const [p] = enrich(
      [
        position({
          symbol: 'Orca',
          platform: 'orca',
          tokens: [leg('SOL', 'supply', 500), leg('USDC', 'supply', 500)],
        }),
      ],
      facts([
        pool({
          id: 'orca:whirlpool',
          platform: 'orca',
          pair: 'SOL|USDC',
          pairLabel: 'SOL/USDC',
          chainLabel: 'Solana',
        }),
      ]),
    );
    assert.equal(p.range, 'in');
    assert.equal(p.band?.pair, 'SOL/USDC');
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
  const facts = (lending: LendingFact[]): DefiFacts => ({ pools: [], lending, failed: [] });
  /** Every fact here is Kamino's, so every position that may have one is a Kamino position */
  const borrower = (over: Partial<ScanPosition>): ScanPosition =>
    position({ symbol: 'Kamino', platform: 'kamino', name: 'Lending', ...over });

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
        borrower({
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

  test('each supplied asset earns its own rate, from the protocol itself', () => {
    const [p] = enrich(
      [
        borrower({
          apy: null,
          tokens: [
            leg('cbBTC', 'supply', 10_424),
            leg('SOL', 'supply', 4_354),
            leg('USDT', 'borrow', -4_200),
          ],
        }),
      ],
      facts([loanFact({ supplyRates: { CBBTC: 0.0032, SOL: 5.84 } })]),
    );
    const bySymbol = new Map((p.tokens ?? []).map((t) => [t.symbol, t.apy]));
    assert.equal(bySymbol.get('cbBTC'), 0.000032);
    assert.equal(bySymbol.get('SOL'), 0.0584);
    assert.equal(bySymbol.get('USDT'), 0.0501);
    assert.equal(p.apy, null);
  });

  test('a supplied asset the protocol said nothing about keeps no rate', () => {
    const [p] = enrich(
      [
        borrower({
          tokens: [leg('JUP', 'supply', 900), leg('USDT', 'borrow', -100)],
        }),
      ],
      facts([loanFact({ supplyRates: { SOL: 5.84 } })]),
    );
    assert.equal((p.tokens ?? []).find((t) => t.symbol === 'JUP')!.apy, undefined);
  });

  test('no matching fact leaves the aggregator rate alone', () => {
    const [p] = enrich(
      [borrower({ borrowApy: 0.0807, tokens: [{ ...leg('USDC', 'borrow', -100), apy: 0.0807 }] })],
      facts([loanFact()]), // fact is about USDT, position borrows USDC
    );
    assert.equal(p.borrowApy, 0.0807);
  });

  test('two facts about the same token cannot pick a side', () => {
    const [p] = enrich(
      [borrower({ borrowApy: 0.0807, tokens: [leg('USDT', 'borrow', -100)] })],
      facts([loanFact(), loanFact({ id: 'kamino:other:reserve', market: 'Main Market', borrowRate: 9.9 })]),
    );
    assert.equal(p.borrowApy, 0.0807);
  });

  test('a fact with no rate still names the market and touches nothing else', () => {
    const [p] = enrich(
      [borrower({ borrowApy: 0.0807, tokens: [leg('USDT', 'borrow', -100)] })],
      facts([loanFact({ borrowRate: null })]),
    );
    assert.equal(p.borrowApy, 0.0807);
    assert.equal(p.loan?.market, 'SOL/BTC Market');
  });

  /**
   * The same asset borrowed at a different protocol. What a loan costs is the
   * lending protocol's own number — and this loan is not that protocol's, so
   * neither its rate nor its market has anything to say here.
   */
  test('a loan of the same asset at another protocol is left alone', () => {
    const [p] = enrich(
      [
        position({
          symbol: 'Compound',
          platform: 'base_compound3',
          name: 'Lending',
          borrowApy: 0.0807,
          tokens: [leg('USDT', 'borrow', -100)],
        }),
      ],
      facts([loanFact()]),
    );
    assert.equal(p.borrowApy, 0.0807);
    assert.equal(p.loan, undefined);
  });
});

describe('enrich — a fact belongs to the position it names', () => {
  const pools = (list: PoolFact[]): DefiFacts => ({ pools: list, lending: [], failed: [] });
  const meteora = (over: Partial<ScanPosition>): ScanPosition =>
    position({
      symbol: 'Meteora',
      platform: 'meteora',
      tokens: [leg('SOL', 'supply', 500), leg('USDC', 'supply', 500)],
      ...over,
    });
  const fact = (over: Partial<PoolFact>): PoolFact =>
    pool({ platform: 'meteora', pair: 'SOL|USDC', pairLabel: 'SOL/USDC', chainLabel: 'Solana', ...over });

  test('two positions of one pool, each named by the source, each get their own band', () => {
    const enriched = enrich(
      [meteora({ ref: 'POSITION_A', pool: 'PAIR' }), meteora({ ref: 'POSITION_B', pool: 'PAIR' })],
      pools([
        fact({ ref: 'POSITION_A', pool: 'PAIR', lowerPrice: 110, upperPrice: 120, inRange: false }),
        fact({ ref: 'POSITION_B', pool: 'PAIR', lowerPrice: 100, upperPrice: 130, inRange: true }),
      ]),
    );
    assert.deepEqual(
      enriched.map((p) => [p.band?.lower, p.range]),
      [
        [110, 'out'],
        [100, 'in'],
      ],
    );
  });

  test('a position named only by its pool takes the one fact read from that pool', () => {
    const [p] = enrich([meteora({ pool: 'PAIR' })], pools([fact({ ref: 'POSITION_A', pool: 'PAIR' })]));
    assert.equal(p.band?.lower, 2000);
  });

  test('the pool cannot choose between two positions in it', () => {
    const [p] = enrich(
      [meteora({ pool: 'PAIR' })],
      pools([fact({ ref: 'POSITION_A', pool: 'PAIR' }), fact({ ref: 'POSITION_B', pool: 'PAIR' })]),
    );
    assert.equal(p.band, undefined);
  });

  test('a fact about another position in the same pool is not this one', () => {
    const [p] = enrich(
      [meteora({ ref: 'POSITION_A', pool: 'PAIR' })],
      pools([fact({ ref: 'POSITION_B', pool: 'PAIR' })]),
    );
    assert.equal(p.band, undefined);
  });

  test('a fact read on another network is not about this position', () => {
    const [p] = enrich(
      [position({ platform: 'arb_uniswap3', network: 'arb', ref: '5854873' })],
      pools([pool({ ref: '5854873', network: 'base' })]),
    );
    assert.equal(p.band, undefined);
  });

  test('one network is one network however it is spelled', () => {
    const [p] = enrich(
      [position({ platform: 'matic_uniswap3', network: 'matic', ref: '5854873' })],
      pools([pool({ ref: '5854873', network: 'polygon' })]),
    );
    assert.equal(p.band?.lower, 2000);
  });
});

describe('enrich — a loan takes the facts of its own account', () => {
  const loanFact = (over: Partial<LendingFact>): LendingFact =>
    ({
      id: 'kamino:obligation:reserve',
      platform: 'kamino',
      market: 'Main Market',
      token: 'USDC',
      healthFactor: 2,
      borrowRate: 5,
      ...over,
    }) as LendingFact;
  const facts = (lending: LendingFact[]): DefiFacts => ({ pools: [], lending, failed: [] });
  const kamino = (over: Partial<ScanPosition>): ScanPosition =>
    position({ symbol: 'Kamino', platform: 'kamino', name: 'Lending', pool: 'MARKET', ...over });

  test('two loans in one market each read their own health and rate', () => {
    const enriched = enrich(
      [
        kamino({ ref: 'OBLIGATION_A', tokens: [leg('SOL', 'supply', 900), leg('USDC', 'borrow', -300)] }),
        kamino({ ref: 'OBLIGATION_B', tokens: [leg('SOL', 'supply', 900), leg('USDC', 'borrow', -300)] }),
      ],
      facts([
        loanFact({ ref: 'OBLIGATION_A', pool: 'MARKET', healthFactor: 1.2, borrowRate: 7 }),
        loanFact({ ref: 'OBLIGATION_B', pool: 'MARKET', healthFactor: 3.4, borrowRate: 7 }),
      ]),
    );
    assert.deepEqual(
      enriched.map((p) => p.healthRate),
      [1.2, 3.4],
    );
  });

  test('a loan in two assets takes both rates, and the bigger debt names it', () => {
    const [p] = enrich(
      [
        kamino({
          ref: 'OBLIGATION_A',
          tokens: [leg('SOL', 'supply', 2000), leg('USDC', 'borrow', -300), leg('USDT', 'borrow', -100)],
        }),
      ],
      facts([
        loanFact({ ref: 'OBLIGATION_A', pool: 'MARKET', token: 'USDC', borrowRate: 5 }),
        loanFact({ ref: 'OBLIGATION_A', pool: 'MARKET', token: 'USDT', borrowRate: 9 }),
      ]),
    );
    assert.equal(p.loan?.token, 'USDC');
    assert.equal(p.borrowApy, 0.06);
    assert.deepEqual(
      (p.tokens ?? []).filter((t) => t.role === 'borrow').map((t) => t.apy),
      [0.05, 0.09],
    );
  });

  test('a market with one account per wallet answers for it without an id', () => {
    const [p] = enrich(
      [
        position({
          symbol: 'Aave V3',
          platform: 'arb_aave3',
          name: 'Lending',
          network: 'arb',
          pool: '0xpool',
          tokens: [leg('WETH', 'supply', 900), leg('USDC', 'borrow', -300), leg('USDT', 'borrow', -300)],
        }),
      ],
      facts([
        loanFact({ platform: 'aave3', pool: '0xpool', network: 'arb', token: 'USDC', borrowRate: 4 }),
        loanFact({ platform: 'aave3', pool: '0xpool', network: 'arb', token: 'USDT', borrowRate: 6 }),
      ]),
    );
    assert.equal(p.borrowApy, 0.05);
  });

  test('the same asset owed on another network is another loan', () => {
    const [p] = enrich(
      [
        position({
          symbol: 'Aave V3',
          platform: 'arb_aave3',
          name: 'Lending',
          network: 'arb',
          borrowApy: 0.08,
          tokens: [leg('USDC', 'borrow', -300)],
        }),
      ],
      facts([loanFact({ platform: 'aave3', network: 'base', market: 'Aave V3 Base', borrowRate: 4 })]),
    );
    assert.equal(p.borrowApy, 0.08);
    assert.equal(p.loan, undefined);
  });

  test('a V3 loan and a V4 loan in the same asset each get their own rate', () => {
    const [v3, v4] = enrich(
      [
        // Zerion's spelling of both the protocol and the network
        position({
          symbol: 'Aave V3',
          platform: 'aave-v3',
          name: 'Lending',
          network: 'ethereum',
          tokens: [leg('USDC', 'borrow', -300)],
        }),
        position({
          symbol: 'Aave V4',
          platform: 'aave4',
          name: 'Lending',
          network: 'eth',
          tokens: [leg('USDC', 'borrow', -300)],
        }),
      ],
      facts([
        loanFact({ platform: 'aave3', network: 'eth', token: 'USDC', borrowRate: 4 }),
        loanFact({ platform: 'aave4', network: 'eth', token: 'USDC', borrowRate: 5 }),
      ]),
    );
    assert.equal(v3.borrowApy, 0.04);
    assert.equal(v4.borrowApy, 0.05);
  });

  test('two assets owed to one market are one loan when the position names no pool', () => {
    const [p] = enrich(
      [
        position({
          symbol: 'Aave V4',
          platform: 'aave-v4',
          name: 'Lending',
          network: 'ethereum',
          tokens: [leg('USDC', 'borrow', -300), leg('USDT', 'borrow', -100)],
        }),
      ],
      facts([
        loanFact({ platform: 'aave4', pool: '0xspoke', network: 'eth', token: 'USDC', borrowRate: 4 }),
        loanFact({ platform: 'aave4', pool: '0xspoke', network: 'eth', token: 'USDT', borrowRate: 8 }),
      ]),
    );
    assert.equal(p.borrowApy, 0.05);
  });

  test('two assets owed to two markets are not guessed between', () => {
    const [p] = enrich(
      [
        position({
          symbol: 'Aave V3',
          platform: 'aave-v3',
          name: 'Lending',
          network: 'ethereum',
          tokens: [leg('USDC', 'borrow', -300), leg('USDT', 'borrow', -100)],
        }),
      ],
      facts([
        loanFact({ platform: 'aave3', pool: '0xcore', network: 'eth', token: 'USDC', borrowRate: 4 }),
        loanFact({ platform: 'aave3', pool: '0xlido', network: 'eth', token: 'USDT', borrowRate: 8 }),
      ]),
    );
    assert.equal(p.borrowApy, undefined);
  });

  test('a farm is not the loan beside it', () => {
    const [p] = enrich(
      [kamino({ name: 'Farming', ref: 'FARM_STATE', pool: 'FARM', tokens: [leg('USDC', 'supply', 900)] })],
      {
        pools: [],
        lending: [],
        supply: [
          {
            id: 'kamino:A:supply',
            ref: 'OBLIGATION_A',
            pool: 'MARKET',
            platform: 'kamino',
            market: 'Main Market',
            rates: { USDC: 6 },
          },
        ],
        failed: [],
      },
    );
    assert.equal(p.apy, undefined);
    assert.equal(p.tokens?.[0].apy, undefined);
  });
});
