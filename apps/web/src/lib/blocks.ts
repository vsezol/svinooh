import type { PositionDto, PositionRange, PositionTokenRole, WalletDto } from '@svinooh/shared';
import { fmtAmount, fmtPrice } from './format';

export interface BlockRow {
  title: string;
  sub: string;
  value: number;
  /** null for a plain wallet holding; set for the legs of a DeFi position */
  role: PositionTokenRole | null;
}

/** Positions grouped by protocol — as in the design (Wallet + a separate block for each DeFi position) */
export interface Block {
  proto: string;
  typeLabel: string | null;
  meta: string | null;
  value: number;
  /** Yield as a fraction (0.42 = 42% APY) */
  apy: number | null;
  /** Health factor of a lending position */
  healthRate: number | null;
  /** Concentrated liquidity only: is the price still inside the range */
  range: PositionRange | null;
  /** How many identical positions were folded into this block (1 — just the one) */
  count: number;
  rows: BlockRow[];
}

/** "1,234 × $0.9865" — the line under a holding */
function amountLine(amount?: number | null, priceUsd?: number | null): string {
  if (amount == null || priceUsd == null) return '';
  return `${fmtAmount(amount)} × ${fmtPrice(priceUsd)}`;
}

const join = (...parts: Array<string | null | undefined>): string =>
  parts.filter(Boolean).join(' · ');

/** Legs of the same token in the same role are one line, not several */
function mergeRows(rows: BlockRow[]): BlockRow[] {
  const merged = new Map<string, BlockRow & { amount: number | null; priceUsd: number | null }>();
  for (const row of rows) {
    const key = `${row.role}|${row.title}`;
    const existing = merged.get(key);
    if (existing) {
      existing.value += row.value;
      // Two lines for the same token: keep the sum, and only keep a "N × $price"
      // line if it still describes what is shown
      if (existing.sub !== row.sub) existing.sub = '';
    } else {
      merged.set(key, { ...row, amount: null, priceUsd: null });
    }
  }
  return [...merged.values()]
    .map(({ amount: _a, priceUsd: _p, ...row }) => row)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

/**
 * Fold positions that are the same thing repeated. Kamino opens a separate
 * farming position per reserve, so a wallet can show a column of identical
 * one-line "Kamino FARMING" cards; those belong in one block. Positions that
 * differ in any visible way — a different Uniswap V3 position id, a different
 * market — keep their own block, because they really are different.
 */
function foldDuplicates(blocks: Block[]): Block[] {
  const folded = new Map<string, Block & { weightedApy: number }>();
  for (const block of blocks) {
    const key = `${block.proto}|${block.typeLabel}|${block.meta}`;
    const existing = folded.get(key);
    if (!existing) {
      folded.set(key, { ...block, weightedApy: (block.apy ?? 0) * block.value });
      continue;
    }
    existing.count += block.count;
    existing.value += block.value;
    existing.rows = existing.rows.concat(block.rows);
    existing.weightedApy += (block.apy ?? 0) * block.value;
    // The worst health factor is the one worth showing; a range badge only
    // survives while every folded position agrees with it
    if (block.healthRate != null) {
      existing.healthRate =
        existing.healthRate == null ? block.healthRate : Math.min(existing.healthRate, block.healthRate);
    }
    if (existing.range !== block.range) existing.range = null;
  }
  return [...folded.values()].map(({ weightedApy, ...block }) => ({
    ...block,
    apy: block.value > 0 && weightedApy !== 0 ? weightedApy / block.value : block.apy,
    rows: mergeRows(block.rows),
  }));
}

/**
 * Tokens (category 'token') are collected row by row into a single "Wallet" block;
 * each DeFi/staking position becomes a separate block, whose rows are the legs it
 * is made of — what's supplied, what has accrued (LP fees, rewards), what's borrowed.
 */
export function buildBlocks(positions: PositionDto[]): Block[] {
  const walletRows: BlockRow[] = [];
  let walletValue = 0;
  const blocks: Block[] = [];

  for (const p of positions) {
    if (p.category === 'token') {
      walletRows.push({
        title: p.symbol,
        sub: join(p.note, amountLine(p.amount, p.priceUsd)) || p.name || '',
        value: p.valueUsd,
        role: null,
      });
      walletValue += p.valueUsd;
      continue;
    }

    // The position's own legs; a position with none (e.g. the Chrome fallback,
    // which only sees protocol totals) simply renders as a header
    const rows: BlockRow[] = (p.tokens ?? []).map((t) => ({
      title: t.symbol,
      sub: amountLine(t.amount, t.priceUsd),
      value: t.valueUsd,
      role: t.role,
    }));
    // No legs, but the position itself is a priced holding (a GM pool, staked
    // TRX). Its only "row" would repeat the header word for word, so the
    // amount goes on the header line instead of below it.
    const selfLine = rows.length ? '' : amountLine(p.amount, p.priceUsd);

    const kind = p.name || (p.category === 'staked' ? 'Staked' : 'DeFi');
    blocks.push({
      proto: p.symbol,
      typeLabel: kind.toUpperCase(),
      meta: join(p.note, selfLine) || null,
      value: p.valueUsd,
      apy: p.apy ?? null,
      healthRate: p.healthRate ?? null,
      range: p.range ?? null,
      count: 1,
      rows,
    });
  }

  const out = foldDuplicates(blocks);

  if (walletRows.length) {
    walletRows.sort((a, b) => b.value - a.value);
    out.push({
      proto: 'Wallet',
      typeLabel: null,
      meta: null,
      value: walletValue,
      apy: null,
      healthRate: null,
      range: null,
      count: 1,
      rows: walletRows,
    });
  }
  out.sort((a, b) => b.value - a.value);
  return out;
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

/**
 * Is this ticker a dollar? Three answers, because "no" and "can't tell" are
 * different things and only one of them should be counted as volatile.
 */
export type AssetKind = 'stable' | 'volatile' | 'unknown';

/** Dollar tokens whose ticker doesn't spell it out */
const STABLE_NAMES = new Set([
  'DAI', 'FRAX', 'TUSD', 'GHO', 'LUSD', 'MIM', 'DOLA', 'BUIDL', 'EURC', 'EURS',
  'SUSDS', 'SUSDE', 'SFRAX', 'SDAI', 'ALUSD', 'BOLD', 'CRVUSD', 'FXUSD',
]);

/** Anything that spells it out: USDC, sUSDe, apxUSD, USDbC, wUSDM… */
const STABLE_SHAPE = /^[A-Z]{0,4}USD[A-Z0-9]{0,4}$/;

/**
 * A basket we can't see inside. A GMX GM token (`GM:SOL/USD[USDC]`) is backed
 * partly by the index asset and partly by USDC, and nothing in our data says in
 * what proportion — so it is neither, and gets reported as unclassified rather
 * than silently lumped in with the volatile half.
 */
const BASKET = /^(gm:|glp\b|gmx-lp)/i;

/**
 * Pendle splits a yield asset into a principal token and a yield token. The
 * principal, `PT-<asset>-<expiry>`, redeems 1:1 for its underlying at maturity,
 * so a PT of a stablecoin is a stablecoin — `PT-sUSDai-15OCT2026` is dollars.
 * The yield token is not: it is a claim on a variable stream.
 */
const PENDLE_PT = /^PT-(.+)-\d{1,2}[A-Z]{3}\d{4}$/i;

export function assetKind(symbolRaw: string): AssetKind {
  const symbol = symbolRaw.trim();
  if (BASKET.test(symbol)) return 'unknown';

  const pt = PENDLE_PT.exec(symbol);
  const core = (pt ? pt[1] : symbol).toUpperCase();

  if (STABLE_NAMES.has(core) || STABLE_SHAPE.test(core)) return 'stable';
  return 'volatile';
}

export interface StableSplit {
  stables: number;
  rest: number;
  /** Value we could not place either way */
  unknown: number;
  /** Share of the CLASSIFIED value held in stablecoins, 0–1 */
  stableShare: number;
  /** How much of the portfolio the split actually covers, 0–1 */
  coverage: number;
}

/**
 * How much of the portfolio sits in dollars. Counted from the legs, so a
 * stablecoin deposited into a lending market still counts as stable — which is
 * the question being asked. Debt is netted off the side it is denominated in.
 */
export function stableSplit(wallets: WalletDto[]): StableSplit {
  let stables = 0;
  let rest = 0;
  let unknown = 0;

  const add = (kind: AssetKind, usd: number) => {
    if (kind === 'stable') stables += usd;
    else if (kind === 'volatile') rest += usd;
    else unknown += usd;
  };

  for (const wallet of wallets) {
    for (const position of wallet.positions) {
      const legs = position.tokens ?? [];
      // No legs: the position IS the asset — staked TRX, a GM pool token
      if (!legs.length) add(assetKind(position.symbol), position.valueUsd);
      else for (const leg of legs) add(assetKind(leg.symbol), leg.valueUsd);
    }
  }

  stables = Math.max(0, stables);
  rest = Math.max(0, rest);
  unknown = Math.max(0, unknown);
  const classified = stables + rest;
  const total = classified + unknown;
  return {
    stables,
    rest,
    unknown,
    stableShare: classified > 0 ? stables / classified : 0,
    coverage: total > 0 ? classified / total : 1,
  };
}

export interface DebtTotals {
  /** Positive: how much is owed */
  total: number;
  /** Value-weighted borrow APY as a fraction, null when no source reported one */
  avgApy: number | null;
  /**
   * Share of the debt the average actually covers, 0–1. DeBank reports no
   * borrow rates at all, so on a mixed portfolio the figure describes only part
   * of what is owed — and saying so is the difference between a number and a
   * misleading one.
   */
  ratedShare: number;
}

/** What the portfolio owes, and what that debt costs on average */
export function debtTotals(wallets: WalletDto[]): DebtTotals {
  let total = 0;
  let weighted = 0;
  let rated = 0;
  for (const wallet of wallets) {
    for (const position of wallet.positions) {
      const debt = (position.tokens ?? [])
        .filter((t) => t.role === 'borrow')
        .reduce((sum, t) => sum + Math.abs(t.valueUsd), 0);
      if (!debt) continue;
      total += debt;
      if (position.borrowApy != null) {
        weighted += position.borrowApy * debt;
        rated += debt;
      }
    }
  }
  return {
    total,
    avgApy: rated > 0 ? weighted / rated : null,
    ratedShare: total > 0 ? rated / total : 0,
  };
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

function isLending(block: Block): boolean {
  const kind = block.typeLabel ?? '';
  if (IS_LENDING_KIND.test(kind)) return true;
  // Borrowing against a position makes it a loan whatever the source calls it
  if (block.rows.some((r) => r.role === 'borrow')) return true;
  return LENDING_PROTOCOLS.test(block.proto) && DEPOSIT_KIND.test(kind);
}

export function blockMatches(block: Block, filter: PositionFilter): boolean {
  if (filter === 'all') return true;
  // The "Wallet" block is plain holdings — it is neither a pool nor a loan
  if (!block.typeLabel) return false;
  return filter === 'pools' ? IS_POOL_KIND.test(block.typeLabel) : isLending(block);
}

/** Total value of everything the filter is currently showing */
export function filteredTotal(blocksByWallet: Block[][], filter: PositionFilter): number {
  return blocksByWallet
    .flat()
    .filter((b) => blockMatches(b, filter))
    .reduce((sum, b) => sum + b.value, 0);
}
