import type { PositionDto, PositionTokenRole } from '@svinooh/shared';
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
  rows: BlockRow[];
}

/** "1,234 × $0.9865" — the line under a holding */
function amountLine(amount?: number | null, priceUsd?: number | null): string {
  if (amount == null || priceUsd == null) return '';
  return `${fmtAmount(amount)} × ${fmtPrice(priceUsd)}`;
}

const join = (...parts: Array<string | null | undefined>): string =>
  parts.filter(Boolean).join(' · ');

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
      rows,
    });
  }

  if (walletRows.length) {
    walletRows.sort((a, b) => b.value - a.value);
    blocks.push({
      proto: 'Wallet',
      typeLabel: null,
      meta: null,
      value: walletValue,
      apy: null,
      healthRate: null,
      rows: walletRows,
    });
  }
  blocks.sort((a, b) => b.value - a.value);
  return blocks;
}
