import type { PositionTokenRole } from '@svinooh/shared';
import { fetchJson } from './http';
import type { ScanPosition, ScanPositionToken, ScanResult } from './types';

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

interface JupPositionAsset {
  value?: number;
  data?: { address?: string; price?: number; amount?: { raw?: string; decimals?: number } };
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
  // 1) Jupiter DeFi portfolio: the sum of value across all elements of all fetchers
  const portfolio = await fetchJson<{ fetcherResults?: Array<{ elements?: JupElement[] }> }>(
    `${JUP_PORTFOLIO_API}/${address}?unpriced=false`,
    { headers: { accept: 'application/json', 'x-api-key': JUP_API_KEY } },
    { timeoutMs: 45_000 },
  );

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
        const amount = d.amount?.raw ? Number(d.amount.raw) / 10 ** (d.amount.decimals ?? 0) : null;
        legs.push({
          symbol: symbolOf(d.address),
          amount,
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
        if (!d?.amount?.raw || !d.address) continue;
        const amount = Number(d.amount.raw) / 10 ** (d.amount.decimals ?? 0);
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
        tokens: elementTokens(element),
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

  return {
    chain: 'SOL',
    address,
    totalUsd: defi + gmtrade,
    positions,
    breakdown: { defi, gmtrade },
    unpriced: unpriced.length ? unpriced : undefined,
  };
}
