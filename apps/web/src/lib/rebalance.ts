import type { PositionBand } from '@svinooh/shared';
import type { Block } from './blocks';

function price(value: number): string {
  if (!Number.isFinite(value)) return '?';
  const abs = Math.abs(value);
  if (abs >= 1) return value.toFixed(2);
  if (abs === 0) return '0';
  return value.toPrecision(4).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
}

/** The question the Telegram alert's button asks, word for word, so the two cannot answer differently. */
export function rebalanceQuestion(band: PositionBand): string {
  return (
    `Rebalance my Meteora ${band.pair} position that went out of range ` +
    `(${price(band.lower)} - ${price(band.upper)} ${band.priceLabel}): close it and place it again ` +
    'around the current price, keeping its width.'
  );
}

export const rebalanceable = (block: Block): block is Block & { band: PositionBand } =>
  block.range === 'out' && block.band !== null && /meteora/i.test(block.proto);
