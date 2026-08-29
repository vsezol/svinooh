import type { PositionDto, PositionRange, PositionTokenRole, WalletDto } from '@svinooh/shared';

/**
 * One line of a position's table.
 *
 * Price and amount are kept apart rather than pre-joined into "1.2 × $3,100",
 * because they are columns now: a wallet is read down a column — biggest
 * holding, cheapest token — and a sentence cannot be read down.
 */
export interface BlockRow {
  /** The token, plus its own rate where a borrow leg reports one */
  title: string;
  /** The network this holding sits on, when it is not already said above */
  network: string | null;
  priceUsd: number | null;
  amount: number | null;
  /** A magnitude — whether it is owed is the section's business */
  value: number;
  /** null for a plain wallet holding; set for the legs of a DeFi position */
  role: PositionTokenRole | null;
}

/**
 * A run of rows under one heading: what the position holds, then what it has
 * accrued, then what it owes.
 *
 * Splitting them is what lets each be read as itself — a fee is not a holding
 * and a debt is not either, and before this they were the same list with badges
 * stamped on to say so.
 */
export interface BlockSection {
  /** null on the holdings, which need no heading: they are what the block is */
  label: string | null;
  /**
   * What the section comes to, or null when it would say nothing — over a
   * single row a total is that row's own figure written twice.
   */
  total: number | null;
  /** Owed rather than held: drawn in the down colour, with a minus */
  negative: boolean;
  /** Column headings are printed once per block, on the first section */
  columns: boolean;
  /** What the first column is called: what a wallet holds, what a position supplied */
  firstColumn: string;
  rows: BlockRow[];
}

/** Positions grouped by protocol — Wallet, then a separate block per DeFi position */
export interface Block {
  proto: string;
  /** The network the position sits on, drawn beside its name */
  network: string | null;
  typeLabel: string | null;
  meta: string | null;
  value: number;
  /** Yield as a fraction (0.42 = 42% APY) */
  apy: number | null;
  /** Health factor of a lending position */
  healthRate: number | null;
  /** What the debt costs overall, where only a position-wide rate is known */
  borrowApy: number | null;
  /** Concentrated liquidity only: is the price still inside the range */
  range: PositionRange | null;
  /** How many identical positions were folded into this block (1 — just the one) */
  count: number;
  sections: BlockSection[];
}

/** Every row of a block, whichever section it sits in */
export function blockRows(block: Block): BlockRow[] {
  return block.sections.flatMap((section) => section.rows);
}

const join = (...parts: Array<string | null | undefined>): string =>
  parts.filter(Boolean).join(' · ');

/**
 * A block before it has been split into sections: the same thing, with its legs
 * still in one list, which is the shape folding and merging need.
 */
type RawBlock = Omit<Block, 'sections'> & { rows: BlockRow[] };

/**
 * What a leg is worth reading first: what the position holds, then what it
 * owes, then what it has accrued.
 *
 * Size alone got this wrong in both directions. A $53M borrow sorted above the
 * $45M supplied against it and read as the position's headline, when it is the
 * other side of that holding; and a few dollars of unclaimed rewards could land
 * in the middle of the legs they came from. Within a role, size still decides.
 */
const ROLE_ORDER: Record<PositionTokenRole, number> = { supply: 0, borrow: 1, reward: 2 };

const roleRank = (role: PositionTokenRole | null): number => (role ? ROLE_ORDER[role] : 0);

/**
 * Legs of the same token in the same role are one line, not several.
 *
 * The amounts add up, and so does the value. The price survives only if the two
 * lines agreed on it — one token at two prices has no single price, and a
 * column is a promise that every cell in it means the same thing.
 */
function mergeRows(rows: BlockRow[]): BlockRow[] {
  const merged = new Map<string, BlockRow>();
  for (const row of rows) {
    const key = `${row.role}|${row.title}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...row });
      continue;
    }
    existing.value += row.value;
    existing.amount =
      existing.amount == null || row.amount == null ? null : existing.amount + row.amount;
    if (existing.priceUsd !== row.priceUsd) existing.priceUsd = null;
    existing.network ??= row.network;
  }
  return [...merged.values()].sort(
    (a, b) => roleRank(a.role) - roleRank(b.role) || Math.abs(b.value) - Math.abs(a.value),
  );
}

/**
 * What a block is made of, by what its legs ARE rather than how much of them
 * there is: the symbols and the roles, in a fixed order.
 *
 * This is what tells two positions in the same protocol apart when nothing in
 * the header does. A GMX V2 position on ETH/USDC and one on BTC/USDC can carry
 * the same protocol, the same kind and the same note, and still be two entirely
 * different bets — the legs are where that shows.
 */
function legSignature(block: RawBlock): string {
  return block.rows
    .map((row) => `${row.role ?? ''}:${row.title}`)
    .sort()
    .join(',');
}

/**
 * Fold positions that are the same thing repeated — and only those.
 *
 * Kamino opens a separate farming position per reserve, so a wallet can show a
 * column of identical one-line "Kamino FARMING" cards; those belong in one
 * block, and folding them loses nothing, because there was nothing to tell them
 * apart in the first place.
 *
 * The legs are part of that judgement now. Folding used to key on the header
 * alone, so three GMX V2 positions with the same note collapsed into one card
 * reading "GMX V2 ×3" whose rows were the SUM of three different markets — a
 * card that answered "how much" and destroyed "in what". A position whose legs
 * differ from its neighbour's is a different position and keeps its own block;
 * two that differ only in size still fold, since summing them says the same
 * thing in one line.
 */
function foldDuplicates(blocks: RawBlock[]): RawBlock[] {
  const folded = new Map<string, RawBlock & { weightedApy: number; weightedBorrowApy: number }>();
  for (const block of blocks) {
    const key = `${block.proto}|${block.typeLabel}|${block.meta}|${legSignature(block)}`;
    const existing = folded.get(key);
    if (!existing) {
      folded.set(key, {
        ...block,
        weightedApy: (block.apy ?? 0) * block.value,
        weightedBorrowApy: (block.borrowApy ?? 0) * block.value,
      });
      continue;
    }
    existing.count += block.count;
    existing.value += block.value;
    existing.rows = existing.rows.concat(block.rows);
    existing.weightedApy += (block.apy ?? 0) * block.value;
    existing.weightedBorrowApy += (block.borrowApy ?? 0) * block.value;
    // The worst health factor is the one worth showing; a range badge only
    // survives while every folded position agrees with it
    if (block.healthRate != null) {
      existing.healthRate =
        existing.healthRate == null ? block.healthRate : Math.min(existing.healthRate, block.healthRate);
    }
    if (existing.range !== block.range) existing.range = null;
  }
  return [...folded.values()].map(({ weightedApy, weightedBorrowApy, ...block }) => ({
    ...block,
    apy: block.value > 0 && weightedApy !== 0 ? weightedApy / block.value : block.apy,
    borrowApy:
      block.value > 0 && weightedBorrowApy !== 0 ? weightedBorrowApy / block.value : block.borrowApy,
    rows: mergeRows(block.rows),
  }));
}

/**
 * Split a block's legs into the sections it is read as.
 *
 * Every accrued leg used to carry its own REWARDS badge and every borrowed one
 * its own DEBT badge, so a position earning four tokens said "REWARDS" four
 * times and a loan across three markets said "DEBT" three times — the same
 * claim stamped on every line it applied to, which is what made a wallet
 * holding a few real positions read as a wall. It belongs to the run of rows,
 * not to each of them, so it is a heading now.
 *
 * The label says what the money actually is: fees are what a liquidity position
 * accrues by being used, rewards are what a protocol pays on top. Both arrive
 * as `reward` legs, so the position's own kind is what tells them apart.
 *
 * A section's total is a summary, and a summary of one thing is that thing — so
 * a single-row section keeps its heading and drops the figure, leaving the row
 * to state its own.
 */
function toSections(block: RawBlock, isWallet: boolean): BlockSection[] {
  const held = block.rows.filter((row) => row.role !== 'reward' && row.role !== 'borrow');
  const firstColumn = isWallet ? 'TOKEN' : 'SUPPLIED';
  const sections: BlockSection[] = [
    { label: null, total: null, negative: false, columns: true, firstColumn, rows: held },
  ];

  const section = (label: string, rows: BlockRow[], negative: boolean): void => {
    if (!rows.length) return;
    sections.push({
      label,
      // Legs arrive signed differently depending on the source; what a section
      // comes to is a magnitude, and the minus is the renderer's business
      total: rows.length > 1 ? rows.reduce((sum, row) => sum + Math.abs(row.value), 0) : null,
      negative,
      // Printed once per block, on the section above
      columns: false,
      firstColumn,
      rows: rows.map((row) => ({ ...row, value: Math.abs(row.value) })),
    });
  };

  section(
    isPoolKind(block.typeLabel) ? 'FEES' : 'REWARDS',
    block.rows.filter((row) => row.role === 'reward'),
    false,
  );
  section('BORROWED', block.rows.filter((row) => row.role === 'borrow'), true);
  return sections;
}

/**
 * Tokens (category 'token') are collected row by row into a single "Wallet" block;
 * each DeFi/staking position becomes a separate block, whose rows are the legs it
 * is made of — what's supplied, what has accrued (LP fees, rewards), what's borrowed.
 */
export function buildBlocks(positions: PositionDto[]): Block[] {
  const walletRows: BlockRow[] = [];
  let walletValue = 0;
  const blocks: RawBlock[] = [];

  for (const p of positions) {
    if (p.category === 'token') {
      walletRows.push({
        title: p.symbol,
        // A held token names its own network — the wallet's chain is the family
        // (EVM), and one EVM wallet holds tokens on a dozen networks
        network: p.network ?? null,
        priceUsd: p.priceUsd ?? null,
        amount: p.amount ?? null,
        value: p.valueUsd,
        role: null,
      });
      walletValue += p.valueUsd;
      continue;
    }

    // The position's own legs; a position with none (e.g. the Chrome fallback,
    // which only sees protocol totals) simply renders as a header
    const rows: BlockRow[] = (p.tokens ?? []).map((t) => ({
      // A borrow leg that knows its own rate says so here, where it is the
      // price of THAT loan; a position-wide rate stays on the position
      title: t.apy == null ? t.symbol : `${t.symbol} · ${(t.apy * 100).toFixed(1)}%`,
      // Legs of a position sit on the position's network, which is already
      // drawn beside its name — saying it again on every row is noise
      network: null,
      priceUsd: t.priceUsd ?? null,
      amount: t.amount ?? null,
      value: t.valueUsd,
      role: t.role,
    }));
    // No legs, but the position itself is a priced holding (a GM pool, staked
    // TRX). Its only row would repeat the header word for word, so it becomes
    // that row instead of an empty table.
    const selfRow: BlockRow[] = rows.length
      ? []
      : [
          {
            title: p.symbol,
            network: null,
            priceUsd: p.priceUsd ?? null,
            amount: p.amount ?? null,
            value: p.valueUsd,
            role: 'supply' as const,
          },
        ];

    const kind = p.name || (p.category === 'staked' ? 'Staked' : 'DeFi');
    blocks.push({
      proto: p.symbol,
      network: p.network ?? null,
      typeLabel: kind.toUpperCase(),
      meta: join(p.note) || null,
      value: p.valueUsd,
      apy: p.apy ?? null,
      healthRate: p.healthRate ?? null,
      borrowApy: p.borrowApy ?? null,
      range: p.range ?? null,
      count: 1,
      rows: rows.length ? rows : selfRow,
    });
  }

  const out = foldDuplicates(blocks);

  if (walletRows.length) {
    walletRows.sort((a, b) => b.value - a.value);
    out.push({
      proto: 'Wallet',
      // Its tokens each name their own network; the block itself is on none
      network: null,
      typeLabel: null,
      meta: null,
      value: walletValue,
      apy: null,
      healthRate: null,
      borrowApy: null,
      range: null,
      count: 1,
      rows: walletRows,
    });
  }
  // Sectioning is the last thing done to a block: folding and merging both work
  // on one flat list of legs, and a heading is not a leg
  return byProtocolThenValue(
    out.map(({ rows, ...block }) => ({
      ...block,
      sections: toSections({ ...block, rows }, block.proto === 'Wallet'),
    })),
  );
}

/**
 * The order the list is read in: a protocol's positions together, and the
 * protocols themselves biggest first.
 *
 * Sorting on value alone scattered them — three Uniswap V3 pools with a lending
 * position between each pair — so seeing what one protocol actually holds meant
 * collecting its cards from down the whole column. Grouping puts them side by
 * side, and it is the GROUP's total that decides where the group sits, so the
 * biggest thing in the wallet still comes first.
 *
 * Two protocols holding the same amount are separated by whichever has the
 * bigger single position, which is what ranking them on the value-sorted list
 * amounts to. That tiebreak is load-bearing, not a nicety — without one, equal
 * groups are free to interleave, which is the one thing this is here to
 * prevent — and it is value all the way down, where sorting them by name would
 * have decided it on something nobody is looking at.
 */
function byProtocolThenValue(blocks: Block[]): Block[] {
  const byValue = [...blocks].sort((a, b) => b.value - a.value);

  const protocolTotal = new Map<string, number>();
  /** Where a protocol's biggest position landed — its rank among protocols */
  const protocolRank = new Map<string, number>();
  byValue.forEach((block, index) => {
    protocolTotal.set(block.proto, (protocolTotal.get(block.proto) ?? 0) + block.value);
    if (!protocolRank.has(block.proto)) protocolRank.set(block.proto, index);
  });

  return byValue.sort(
    (a, b) =>
      (protocolTotal.get(b.proto) ?? 0) - (protocolTotal.get(a.proto) ?? 0) ||
      (protocolRank.get(a.proto) ?? 0) - (protocolRank.get(b.proto) ?? 0) ||
      b.value - a.value,
  );
}

/** Unclaimed rewards across a portfolio, split into pool fees and everything else */
export interface RewardsTotals {
  /** Fees accrued in liquidity pools */
  pools: number;
  /** Farming, staking and lending rewards */
  other: number;
  total: number;
}

const IS_POOL = /pool|liquidity|lp\b/i;

/**
 * What is sitting unclaimed across every wallet. Reward legs are already part of
 * each position's value, so this is a view onto the same money — "what could I
 * collect right now" — not an addition to the total.
 */
export function rewardsTotals(wallets: WalletDto[]): RewardsTotals {
  let pools = 0;
  let other = 0;
  for (const wallet of wallets) {
    for (const position of wallet.positions) {
      const accrued = (position.tokens ?? [])
        .filter((t) => t.role === 'reward')
        .reduce((sum, t) => sum + t.valueUsd, 0);
      if (!accrued) continue;
      if (IS_POOL.test(position.name ?? '')) pools += accrued;
      else other += accrued;
    }
  }
  return { pools, other, total: pools + other };
}

export interface DebtTotals {
  /** Positive: how much is owed */
  total: number;
}

/** What the portfolio owes */
export function debtTotals(wallets: WalletDto[]): DebtTotals {
  let total = 0;
  for (const wallet of wallets) {
    for (const position of wallet.positions) {
      total += (position.tokens ?? [])
        .filter((t) => t.role === 'borrow')
        .reduce((sum, t) => sum + Math.abs(t.valueUsd), 0);
    }
  }
  return { total };
}

/** Which positions the list is showing */
export type PositionFilter = 'all' | 'pools' | 'lending';

const IS_POOL_KIND = /pool|liquidity|\blp\b/i;
const IS_LENDING_KIND = /lend|borrow/i;

/**
 * Money markets, matched on the protocol rather than the position kind.
 *
 * The kind alone can't answer "is this lending": DeBank labels an Aave deposit
 * "Lending" but a Fluid one "Yield", and "Yield" is a catch-all it also uses for
 * Hyperliquid vaults and an Avantis tranche, which are not lending at all. So
 * the kind decides when it is explicit, and this list decides when it says
 * "Yield" or "Deposit".
 */
const LENDING_PROTOCOLS =
  /^(aave|fluid|compound|morpho|spark|venus|radiant|euler|benqi|kamino|marginfi|save\b|solend|lista|silo|moonwell|seamless|zerolend|granary|justlend)/i;

/** Kinds that mean "assets sitting in the protocol", as opposed to staking or farming */
const DEPOSIT_KIND = /^(yield|deposit|supplied|lending)/i;

/**
 * Is this a liquidity position, by the kind its protocol calls it.
 *
 * Exported because more than one part of the UI needs the answer and none of
 * them should be deciding it for themselves — what counts as a pool is one
 * fact, and a second copy of it is a second thing to be wrong.
 */
export function isPoolKind(kind: string | null | undefined): boolean {
  return !!kind && IS_POOL_KIND.test(kind);
}

/**
 * Is this a loan, from the pieces rather than from a `Block` — for callers that
 * hold positions and not blocks. Same rule as `isLending` below, which is now
 * this function with a block taken apart.
 */
export function isLendingLike(
  kind: string | null | undefined,
  protocol: string,
  hasBorrowLeg: boolean,
): boolean {
  const label = kind ?? '';
  if (IS_LENDING_KIND.test(label)) return true;
  // Borrowing against a position makes it a loan whatever the source calls it
  if (hasBorrowLeg) return true;
  return LENDING_PROTOCOLS.test(protocol) && DEPOSIT_KIND.test(label);
}

function isLending(block: Block): boolean {
  return isLendingLike(
    block.typeLabel,
    block.proto,
    blockRows(block).some((row) => row.role === 'borrow'),
  );
}

/**
 * A holding the market is currently pricing as a dollar.
 *
 * Read off the price the scanner already found, rather than matched against a
 * list of tickers. A list is a second definition of what a stablecoin is: it
 * has to be edited every time one launches, it is wrong about every chain's
 * wrapped variant, and it is never right for long. The price is a fact we were
 * already given, and for a question about exposure "priced at a dollar" is the
 * claim actually being made.
 *
 * The band is wide enough for ordinary spread and narrow enough that nothing
 * volatile drifts into it.
 */
export function isStablePrice(priceUsd: number | null | undefined): boolean {
  return priceUsd != null && Math.abs(priceUsd - 1) <= 0.01;
}

export function blockMatches(block: Block, filter: PositionFilter): boolean {
  if (filter === 'all') return true;
  // The "Wallet" block is plain holdings — it is neither a pool nor a loan
  if (!block.typeLabel) return false;
  return filter === 'pools' ? isPoolKind(block.typeLabel) : isLending(block);
}

/** Total value of everything the filter is currently showing */
export function filteredTotal(blocksByWallet: Block[][], filter: PositionFilter): number {
  return blocksByWallet
    .flat()
    .filter((b) => blockMatches(b, filter))
    .reduce((sum, b) => sum + b.value, 0);
}
