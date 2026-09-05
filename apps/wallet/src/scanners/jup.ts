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
 * Second opinions on Jupiter's prices — but only from a witness that can
 * prove it was awake.
 *
 * portfolio/v2 is served by a fleet, and on 2026-09-04 one replica's price
 * snapshot froze: cbBTC at $81.8k while BTC moved on, a ~$280 tooth on every
 * scan that landed on the stale node. The first cut of this fix arbitrated
 * with the asset search (datapi) — which promptly failed the other way:
 * queried from production's egress region, datapi served the SAME stale
 * snapshot, agreed with the sick replica, and on one scan "corrected" an
 * honest portfolio answer UP to the stale price. An arbiter that can be as
 * stale as the thing it arbitrates is not an arbiter.
 *
 * So the reference price must carry proof of freshness, and Jupiter's price
 * API does: `blockId`, the slot the price was computed at. The caller compares
 * it against the chain's current slot (read from our own RPC path, which does
 * not share Jupiter's infrastructure) and hands this function only the prices
 * whose slot is recent. A regional stale node betrays itself with an old slot
 * and simply disqualifies — leaving the worst case at the original sawtooth,
 * never an active mis-correction.
 *
 * A leg whose price disagrees with a qualified reference by more than the
 * threshold is repriced to it, and the element's value moves by exactly the
 * difference that leg contributed — supplied, rewards and held legs push a
 * position's value up, borrowed legs pull it down. Both thresholds have to
 * trip: the relative one spares ordinary dispersion between two live feeds,
 * the absolute one spares dust legs. Every reprice is reported to the caller,
 * because a corrected total should never be a silent one.
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

