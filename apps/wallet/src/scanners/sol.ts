import type { PositionTokenRole } from '@svinooh/shared';
import { fetchJson } from './http';
import { rangeFromLegs } from '@svinooh/common';
import { enrich, needsLendingFacts, NO_FACTS } from '@svinooh/common';
import { solanaLendingFacts, solanaPoolFacts } from './defi';
import { meteoraPositions, type MeteoraPoolPosition } from './defi/meteora';
import type { ScanPosition, ScanPositionToken, ScanResult } from '@svinooh/shared';

/**
 * SOL: Jupiter portfolio API — a full DeFi aggregator (231 fetchers across
 * ~118 platforms: Kamino, Meteora, MarginFi, Drift, Orca…), plus GMTrade GM
 * pools, which Jupiter sees but doesn't price.
 *
 * Solana RPC is deliberately not used: Jupiter returns everything needed in a
 * single keyless request; RPC would only add a dependency and a rate limit.
 *
 * Each element carries the legs it's made of — `assets`/`suppliedAssets`,
 * `rewardAssets` (unclaimed LP fees and farming rewards), `borrowedAssets`
 * (debt) — plus netApy and healthRatio. We surface all of it: an LP shows its
 * pair AND its accrued fees, a lending market shows its collateral AND its debt.
 *
 * A GM token's price is the pool's NAV (deposits net of traders' open PnL),
 * NOT pool TVL / supply: the TVL variant consistently overstated by 8–12%.
 * The correct source is gmPriceNow from the GMX-Solana indexer, divided by
 * 1e11. Verified against the connected wallet, 0.4% deviation. Don't "simplify"
 * it back to TVL/supply.
 */

const JUP_PORTFOLIO_API = 'https://api.jup.ag/portfolio/v2/positions';
// Public key from the JS bundle of Jupiter's own portfolio page —
// not a secret and not a bypass of paid access.
const JUP_API_KEY =
  process.env.JUP_API_KEY || 'jup_103f2da0530554e4eb01d8f4af2fcda75b309d2b71aa1bcdfd17e411c59056d8';
const JUP_BALANCES_API = 'https://lite-api.jup.ag/ultra/v1/balances';
const JUP_ASSETS_API = 'https://datapi.jup.ag/v1/assets/search';
const GM_INDEXER_API = 'https://gmx-solana-sqd.squids.live/gmx-solana-base:prod/api/graphql';
const SOL_NATIVE_MINT = '11111111111111111111111111111111';

interface JupAsset {
  id: string;
  name?: string;
  symbol?: string;
  usdPrice?: number;
}

interface JupAmount {
  /** true — `raw` holds an integer in the token's smallest unit; false — `value` is already scaled */
  fixed?: boolean;
  raw?: string;
  value?: number;
  decimals?: number;
}

interface JupPositionAsset {
  value?: number;
  data?: { address?: string; price?: number; amount?: JupAmount };
}

interface JupYield {
  apr?: number;
  apy?: number;
}

interface JupElement {
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
const ASSET_BUCKETS: Array<{ key: 'assets' | 'suppliedAssets' | 'rewardAssets' | 'borrowedAssets'; role: PositionTokenRole }> = [
  { key: 'assets', role: 'supply' },
  { key: 'suppliedAssets', role: 'supply' },
  { key: 'rewardAssets', role: 'reward' },
  { key: 'borrowedAssets', role: 'borrow' },
];

/** Element labels that are staking rather than "generic DeFi" */
const STAKED_LABELS = /^(staked|staking|farming|vesting|locked|deposit)$/i;

/**
 * Pool kinds that have a price range. Jupiter names them in `element.name`
 * (Meteora DLMM, Raydium CLMM, Orca Whirlpool); a constant-product pool has no
 * range and must not get a badge.
 */
const RANGED_POOLS = /\b(dlmm|clmm|whirlpool|concentrated)\b/i;

const isGmPoolToken = (name?: string | null): boolean => /^GM:\S+\[\w+\]$/.test(name || '');

/** "LiquidityPool" → "Liquidity Pool"; Jupiter labels come glued together */
const humanizeLabel = (label: string): string =>
  label.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());

/** "kamino" → "Kamino" — Jupiter has no display name for a platform */
const platformTitle = (id: string): string => id.charAt(0).toUpperCase() + id.slice(1);

/**
 * Jupiter reports `healthRatio` as headroom in [0, 1) — 0 is liquidation, higher
 * is safer — whereas DeBank reports the classic health factor (>1 safe). Those
 * are the same quantity on different scales: headroom = 1 − 1/HF, so HF =
 * 1/(1 − headroom). Checked against Kamino SOL/BTC: headroom 0.6895 → HF 3.22,
 * and maxLTV·supplied/borrowed on the same position ≈ 3.19. We normalize to the
 * health factor so one number means one thing across every chain.
 * No debt (headroom ≈ 1) means no liquidation risk — nothing worth showing.
 */
function toHealthFactor(headroom: number | undefined): number | null {
  if (typeof headroom !== 'number' || !isFinite(headroom)) return null;
  if (headroom <= 0) return 0; // already liquidatable
  if (headroom >= 0.999) return null;
  return 1 / (1 - headroom);
}

const shortMint = (mint: string): string => `${mint.slice(0, 4)}…${mint.slice(-4)}`;

/**
 * What the debt on a lending position costs, weighted by how much of it is
 * borrowed in each asset. `borrowedYields` runs parallel to `borrowedAssets`,
 * and the first entry of each is the borrow rate itself — negative, because to
 * the borrower it is a cost. We return it positive: "you pay this much".
 * Later entries are incentives paid back to the borrower, so they are ignored
 * here; netApy on the element already accounts for them.
 */
function borrowApyOf(element: JupElement): number | null {
  const borrowed = element.data?.borrowedAssets || [];
  const yields = element.data?.borrowedYields || [];
  let weighted = 0;
  let total = 0;
  for (let i = 0; i < borrowed.length; i++) {
    const usd = Math.abs(borrowed[i]?.value ?? 0);
    const apy = yields[i]?.[0]?.apy;
    if (!usd || typeof apy !== 'number') continue;
    weighted += Math.abs(apy) * usd;
    total += usd;
  }
  return total > 0 ? weighted / total : null;
}

/**
 * Jupiter reports an amount in one of two shapes, and which one it uses varies
 * by fetcher: `{fixed: true, raw}` needs scaling by decimals, `{fixed: false,
 * value}` is already scaled. Reading only `raw` loses the amount on every
 * position that uses the other shape — and drops wallet tokens entirely.
 */
function uiAmount(amount: JupAmount | undefined): number | null {
  if (!amount) return null;
  if (amount.raw !== undefined) return Number(amount.raw) / 10 ** (amount.decimals ?? 0);
  if (typeof amount.value === 'number') return amount.value;
  return null;
}

async function fetchGmPrices(mints: string[]): Promise<Record<string, number>> {
  if (!mints.length) return {};
  const ids = mints.map((m) => JSON.stringify(m)).join(',');
  const query = `{ marketGmInfos(where: { id_in: [${ids}] }) { id gmPriceNow } }`;
  const res = await fetchJson<{ data?: { marketGmInfos?: Array<{ id: string; gmPriceNow: string }> } }>(
    GM_INDEXER_API,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) },
  );
  const prices: Record<string, number> = {};
  for (const info of res.data?.marketGmInfos || []) prices[info.id] = Number(info.gmPriceNow) / 1e11;
  return prices;
}

/** Batch metadata lookup — Jupiter caps a search at ~30 mints per call */
async function fetchAssetInfo(mints: string[]): Promise<Map<string, JupAsset>> {
  const info = new Map<string, JupAsset>();
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    const assets = await fetchJson<JupAsset[]>(`${JUP_ASSETS_API}?query=${chunk.join(',')}`);
    for (const asset of Array.isArray(assets) ? assets : []) info.set(asset.id, asset);
  }
  return info;
}

export async function scanSol(address: string): Promise<ScanResult> {
  // 1) Jupiter DeFi portfolio: the sum of value across all elements of all fetchers.
  //    Alongside it, the protocols themselves — Orca, Meteora and Kamino answer
  //    what Jupiter does not: whether a concentrated position is actually in its
  //    band, and what a loan's health and rate are. They run together because
  //    neither waits on the other, and the facts are only read at the end.
  const [portfolio, poolFacts, meteoraByPool] = await Promise.all([
    fetchJson<{ fetcherResults?: Array<{ elements?: JupElement[] }> }>(
      `${JUP_PORTFOLIO_API}/${address}?unpriced=false`,
      { headers: { accept: 'application/json', 'x-api-key': JUP_API_KEY } },
      { timeoutMs: 45_000 },
    ),
    solanaPoolFacts(address),
    // Per-pool Meteora truth, to undo Jupiter's aggregation below. Best-effort:
    // if it fails we keep Jupiter's single (merged) position rather than none.
    meteoraPositions(address).catch(() => []),
  ]);

  let defi = 0;
  const elements: JupElement[] = [];
  for (const fetcher of portfolio.fetcherResults || []) {
    for (const element of fetcher.elements || []) {
      if (typeof element.value === 'number' && isFinite(element.value)) defi += element.value;
      elements.push(element);
    }
  }

  // 2) Token balances + metadata: needed for GM pools, position tickers and the
  //    legs of DeFi positions (whose mints need not be held in the wallet)
  const balancesRaw = await fetchJson<Record<string, { uiAmount?: number }>>(
    `${JUP_BALANCES_API}/${address}`,
  );
  const balances = new Map<string, number>();
  for (const [mint, info] of Object.entries(balancesRaw)) {
    if (mint !== 'SOL' && (info?.uiAmount || 0) > 0) balances.set(mint, info!.uiAmount!);
  }

  const referenced = new Set<string>(balances.keys());
  for (const element of elements) {
    for (const { key } of ASSET_BUCKETS) {
      for (const asset of element.data?.[key] || []) {
        if (asset?.data?.address) referenced.add(asset.data.address);
      }
    }
  }

  const assetInfo = await fetchAssetInfo([...referenced]);
  const symbolOf = (mint: string): string =>
    mint === SOL_NATIVE_MINT
      ? 'SOL'
      : assetInfo.get(mint)?.symbol || assetInfo.get(mint)?.name || shortMint(mint);

  // 3) GM pools: gmtrade is in Jupiter's platform list, but its fetcher
  //    returns 0 elements — so GM is counted separately on top;
  //    it's not a duplicate and can safely be summed.
  const mints = [...balances.keys()];
  const gmHoldings = mints
    .filter((mint) => {
      const asset = assetInfo.get(mint);
      return asset && isGmPoolToken(asset.name) && !asset.usdPrice;
    })
    .map((mint) => ({ mint, name: assetInfo.get(mint)!.name!, amount: balances.get(mint)! }));

  const gmPrices = await fetchGmPrices(gmHoldings.map((h) => h.mint));
  const pools = gmHoldings.map((h) => ({
    ...h,
    price: gmPrices[h.mint] || 0,
    usd: h.amount * (gmPrices[h.mint] || 0),
  }));
  const gmtrade = pools.reduce((sum, p) => sum + p.usd, 0);

  /** The legs of one element, in display order: supplied → accrued → borrowed */
  const elementTokens = (element: JupElement): ScanPositionToken[] => {
    const legs: ScanPositionToken[] = [];
    for (const { key, role } of ASSET_BUCKETS) {
      for (const asset of element.data?.[key] || []) {
        const d = asset?.data;
        if (!d?.address) continue;
        const usd = typeof asset.value === 'number' ? asset.value : 0;
        if (Math.abs(usd) < 0.01) continue; // dust leg — noise, not detail
        legs.push({
          symbol: symbolOf(d.address),
          amount: uiAmount(d.amount),
          priceUsd: typeof d.price === 'number' ? d.price : null,
          valueUsd: role === 'borrow' ? -usd : usd,
          role,
        });
      }
    }
    return legs;
  };

  // Positions for display (the total is computed above — exactly as in the reference)
  const positions: ScanPosition[] = [];
  const unpriced: string[] = [];

  for (const element of elements) {
    const assets = element.data?.assets;
    if ((element.serviceId || '').startsWith('wallet-tokens') && Array.isArray(assets)) {
      // Expand held tokens one by one
      for (const asset of assets) {
        const d = asset?.data;
        const amount = uiAmount(d?.amount);
        if (amount === null || !d?.address) continue;
        const price = typeof d.price === 'number' ? d.price : 0;
        const valueUsd = amount * price;
        if (valueUsd < 0.01) continue; // dust
        positions.push({
          symbol: symbolOf(d.address),
          amount,
          priceUsd: price,
          valueUsd,
          platform: 'wallet',
          category: 'token',
        });
      }
    } else {
      const value = typeof element.value === 'number' && isFinite(element.value) ? element.value : 0;
      if (value < 0.01) continue;
      const platform = element.platformId || null;
      const tokens = elementTokens(element);
      positions.push({
        symbol: platform ? platformTitle(platform) : element.name || element.label || 'Position',
        name: element.label ? humanizeLabel(element.label) : element.type || null,
        // The market/pool name ("SOL/BTC Market", "DLMM") — the element's own label
        note: element.name || null,
        valueUsd: value,
        platform,
        category: STAKED_LABELS.test(element.label || '') ? 'staked' : 'defi',
        apy: typeof element.netApy === 'number' && element.netApy !== 0 ? element.netApy : null,
        healthRate: toHealthFactor(element.data?.healthRatio),
        borrowApy: borrowApyOf(element),
        range: RANGED_POOLS.test(element.name || '') ? rangeFromLegs(tokens) : null,
        tokens,
      });
    }
  }

  for (const pool of pools) {
    if (pool.price > 0) {
      positions.push({
        symbol: pool.name,
        name: 'Liquidity Pool',
        note: 'GMX Solana',
        amount: pool.amount,
        priceUsd: pool.price,
        valueUsd: pool.usd,
        platform: 'gmtrade',
        category: 'defi',
      });
    } else {
      unpriced.push(`GM pool ${pool.name}`);
    }
  }

  // Jupiter aggregates every Meteora pool a wallet holds into ONE element, so
  // two pools arrive as a single position — see splitMeteoraByPool
  const meteoraSplit = splitMeteoraByPool(positions, meteoraByPool);
  positions.length = 0;
  positions.push(...meteoraSplit);

  // Kamino is only worth its 38 markets when Jupiter described a loan without
  // saying how healthy it is or what it costs, which is not the usual case
  const lendingFacts = needsLendingFacts(positions)
    ? await solanaLendingFacts(address)
    : NO_FACTS;

  return {
    chain: 'SOL',
    address,
    totalUsd: defi + gmtrade,
    // Jupiter decides what is held and what it is worth; the protocols only
    // fill in the fields it leaves blank. Nothing here adds or removes a
    // position, so a failed source costs detail and never a holding.
    positions: enrich(enrich(positions, poolFacts), lendingFacts),
    breakdown: { defi, gmtrade },
    unpriced: unpriced.length ? unpriced : undefined,
  };
}

/**
 * Break Jupiter's one merged Meteora element back into the pools it really is.
 *
 * Jupiter aggregates every Meteora pool a wallet holds into a single position,
 * so two pools arrive as one line with one set of legs. Meteora reports them
 * per pool, so when there is more than one, this shares Jupiter's figures out
 * across them. Jupiter's total stays the authority — divided by each pool's
 * balance — so the portfolio total does not move. One pool changes nothing:
 * Jupiter's position, with its exact legs, stands as it came.
 *
 * The two sources are asked only what each of them knows. Meteora knows which
 * pool is which, what it is worth and which of them the unclaimed fees sat in.
 * Jupiter knows what those fees are MADE of — it is the only one that names the
 * tokens — and what the whole holding is worth in dollars.
 */
export function splitMeteoraByPool(
  positions: ScanPosition[],
  meteoraByPool: MeteoraPoolPosition[],
): ScanPosition[] {
  if (meteoraByPool.length < 2) return positions;

  const merged = positions.filter((p) => p.platform === 'meteora');
  const mergedValue = merged.reduce((sum, p) => sum + p.valueUsd, 0);
  // What Jupiter said was accrued but unclaimed, across all the pools at once.
  // Splitting used to drop these on the floor, which is how a wallet with two
  // Meteora pools stopped showing any fees: with one pool Jupiter's position
  // stands untouched and the rewards are right there, so it read as the pools
  // themselves having stopped paying.
  const mergedRewards = merged.flatMap((p) => (p.tokens ?? []).filter((t) => t.role === 'reward'));
  const poolTotal = meteoraByPool.reduce((sum, p) => sum + p.valueUsd, 0) || 1;
  const feeTotal = meteoraByPool.reduce((sum, p) => sum + p.feesUsd, 0);

  const out = positions.filter((p) => p.platform !== 'meteora');
  for (const pool of meteoraByPool) {
    const valueShare = pool.valueUsd / poolTotal;
    const valueUsd = mergedValue > 0 ? mergedValue * valueShare : pool.valueUsd;
    // Which pool the fees belong to is Meteora's to say; where it reports none
    // at all, the value share is the only division left.
    const rewardShare = feeTotal > 0 ? pool.feesUsd / feeTotal : valueShare;
    const rewards = mergedRewards
      .map((t) => ({
        ...t,
        amount: t.amount == null ? null : t.amount * rewardShare,
        valueUsd: t.valueUsd * rewardShare,
      }))
      .filter((t) => t.valueUsd > 0.005);
    // The legs of a position add up to the position, here as everywhere else:
    // what is accrued is part of what it is worth, not something on top of it
    const accrued = rewards.reduce((sum, t) => sum + t.valueUsd, 0);
    const principal = Math.max(valueUsd - accrued, 0);
    out.push({
      symbol: 'Meteora',
      name: 'Liquidity Pool',
      note: pool.pairLabel,
      valueUsd,
      platform: 'meteora',
      category: 'defi',
      range: pool.inRange ? 'in' : 'out',
      // The pair is what tells one pool from the other (and keys the alert); the
      // per-leg split Jupiter had is gone once it merges them, so these halves
      // are nominal — enrich re-attaches the real band from Meteora.
      tokens: [
        { symbol: pool.tokenX, amount: null, priceUsd: null, valueUsd: principal / 2, role: 'supply' as const },
        { symbol: pool.tokenY, amount: null, priceUsd: null, valueUsd: principal / 2, role: 'supply' as const },
        ...rewards,
      ],
    });
  }
  return out;
}
