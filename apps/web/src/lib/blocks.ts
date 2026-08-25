import type { PositionDto } from '@svinooh/shared';
import { fmtAmount, fmtPrice } from './format';

export interface BlockRow {
  title: string;
  sub: string;
  value: number;
}

/** Positions grouped by protocol — as in the design (Wallet + a separate block for each DeFi position) */
export interface Block {
  proto: string;
  typeLabel: string | null;
  meta: string | null;
  value: number;
  rows: BlockRow[];
}

/**
 * Tokens (category 'token') are collected row by row into a single "Wallet" block;
 * each DeFi/staking position becomes a separate block with a protocol heading.
 */
export function buildBlocks(positions: PositionDto[]): Block[] {
  const walletRows: BlockRow[] = [];
  let walletValue = 0;
  const blocks: Block[] = [];

  for (const p of positions) {
    if (p.category === 'token') {
      const sub =
        p.amount != null && p.priceUsd != null
          ? `${fmtAmount(p.amount)} × ${fmtPrice(p.priceUsd)}`
          : p.name || '';
      walletRows.push({ title: p.symbol, sub, value: p.valueUsd });
      walletValue += p.valueUsd;
    } else {
      const typeLabel =
        p.category === 'staked'
          ? 'STAKING'
          : p.platform && p.platform !== 'wallet' && p.platform !== 'debank'
            ? p.platform.toUpperCase()
            : 'DEFI';
      const meta = p.name && p.name !== p.symbol ? p.name : null;
      blocks.push({ proto: p.symbol, typeLabel, meta, value: p.valueUsd, rows: [] });
    }
  }

  if (walletRows.length) {
    walletRows.sort((a, b) => b.value - a.value);
    blocks.push({ proto: 'Wallet', typeLabel: null, meta: null, value: walletValue, rows: walletRows });
  }
  blocks.sort((a, b) => b.value - a.value);
  return blocks;
}
