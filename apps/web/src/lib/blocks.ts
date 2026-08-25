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
    // No legs but the position itself is a priced holding (a GM pool, staked TRX)
    if (!rows.length && p.amount != null && p.priceUsd != null) {
      rows.push({ title: p.symbol, sub: amountLine(p.amount, p.priceUsd), value: p.valueUsd, role: 'supply' });
    }

    const kind = p.name || (p.category === 'staked' ? 'Staked' : 'DeFi');
    blocks.push({
      proto: p.symbol,
      typeLabel: kind.toUpperCase(),
      meta: p.note ?? null,
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
