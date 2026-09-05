import type { PositionTokenRole } from '@svinooh/shared';

/**
 * The shapes Jupiter's portfolio answers in, and the arithmetic that reads
 * them — importable without dragging the rest of the scanner (and its
 * settings registry, HTTP stack and protocol clients) along. The scan itself
 * stays in sol.ts.
 */
export interface JupAsset {
  id: string;
  name?: string;
  symbol?: string;
  usdPrice?: number;
}

export interface JupAmount {
  /** true — `raw` holds an integer in the token's smallest unit; false — `value` is already scaled */
  fixed?: boolean;
  raw?: string;
  value?: number;
  decimals?: number;
}

export interface JupPositionAsset {
  value?: number;
  data?: { address?: string; price?: number; amount?: JupAmount };
}

export interface JupYield {
  apr?: number;
  apy?: number;
}

export interface JupElement {
  platformId?: string;
  serviceId?: string;
  label?: string;
  name?: string;
  type?: string;
  value?: number;
  netApy?: number;
  data?: {
    assets?: JupPositionAsset[];
    suppliedAssets?: JupPositionAsset[];
    borrowedAssets?: JupPositionAsset[];
    rewardAssets?: JupPositionAsset[];
    /** One entry per borrowed asset, each a list whose first item is the rate */
    borrowedYields?: JupYield[][];
    healthRatio?: number;
  };
}


/** Which leg of a position each Jupiter asset bucket is */
export const ASSET_BUCKETS: Array<{ key: 'assets' | 'suppliedAssets' | 'rewardAssets' | 'borrowedAssets'; role: PositionTokenRole }> = [
  { key: 'assets', role: 'supply' },
  { key: 'suppliedAssets', role: 'supply' },
  { key: 'rewardAssets', role: 'reward' },
  { key: 'borrowedAssets', role: 'borrow' },
];


export function uiAmount(amount: JupAmount | undefined): number | null {
  if (!amount) return null;
  if (amount.raw !== undefined) return Number(amount.raw) / 10 ** (amount.decimals ?? 0);
  if (typeof amount.value === 'number') return amount.value;
  return null;
}


/**
 * Second opinions on Jupiter's prices, from Jupiter.
 *
 * portfolio/v2 is served by a fleet, and on 2026-09-04 one replica's price
 * snapshot froze: every answer it served priced cbBTC at $81.8k while BTC —
 * and every other replica — moved on. Two answers seconds apart differed by
 * 2.7% on the same amounts, and a wallet's chart turned into a sawtooth with a
 * tooth on every scan that landed on the stale node.
 *
 * The asset search (datapi) is a separate service with a live price per mint,
 * and this scan already calls it for every referenced mint. So it arbitrates:
 * a leg whose price disagrees with datapi's by more than the threshold is
 * repriced to datapi's number, and the element's value moves by exactly the
 * difference that leg contributed — supplied, rewards and held legs push a
 * position's value up, borrowed legs pull it down.
 *
 * Both thresholds have to trip before anything is touched. The relative one
 * keeps ordinary dispersion between two live feeds alone; the absolute one
 * keeps dust legs from being rewritten over fractions of a cent. Every
 * reprice is reported to the caller, because a corrected total should never
 * be a silent one.
 */
const REPRICE_REL = 0.015;
const REPRICE_ABS_USD = 0.5;

export function repriceElements(
  elements: JupElement[],
  priceOf: (mint: string) => number | undefined,
): string[] {
  const notes: string[] = [];
  for (const element of elements) {
    for (const { key, role } of ASSET_BUCKETS) {
      for (const asset of element.data?.[key] || []) {
        const d = asset?.data;
        if (!d?.address || typeof d.price !== 'number' || d.price <= 0) continue;
        const reference = priceOf(d.address);
        if (typeof reference !== 'number' || reference <= 0) continue;
        if (Math.abs(d.price / reference - 1) <= REPRICE_REL) continue;
        const amount = uiAmount(d.amount);
        if (amount === null) continue;
        const delta = amount * (reference - d.price);
        if (Math.abs(delta) < REPRICE_ABS_USD) continue;

        notes.push(
          `${d.address.slice(0, 6)} in ${element.platformId ?? element.serviceId ?? '?'}: ` +
            `$${d.price.toFixed(2)} -> $${reference.toFixed(2)} (${delta >= 0 ? '+' : ''}$${delta.toFixed(2)})`,
        );
        d.price = reference;
        if (typeof asset.value === 'number') asset.value = amount * reference;
        if (typeof element.value === 'number') {
          element.value += role === 'borrow' ? -delta : delta;
        }
      }
    }
  }
  return notes;
}

