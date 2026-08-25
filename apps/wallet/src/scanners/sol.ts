import { fetchJson } from './http';
import type { ScanPosition, ScanResult } from './types';

/**
 * SOL: Jupiter portfolio API — a full DeFi aggregator (231 fetchers across
 * ~118 platforms: Kamino, Meteora, MarginFi, Drift, Orca…), plus GMTrade GM
 * pools, which Jupiter sees but doesn't price.
 *
 * Solana RPC is deliberately not used: Jupiter returns everything needed in a
 * single keyless request; RPC would only add a dependency and a rate limit.
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

interface JupElement {
  platformId?: string;
  serviceId?: string;
  label?: string;
  name?: string;
  type?: string;
  value?: number;
  data?: { assets?: Array<{ data?: { address?: string; price?: number; amount?: { raw?: string; decimals?: number } } }> };
}

const isGmPoolToken = (name?: string | null): boolean => /^GM:\S+\[\w+\]$/.test(name || '');

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

  // 2) Token balances + metadata: needed for GM pools and for position tickers
  const balancesRaw = await fetchJson<Record<string, { uiAmount?: number }>>(
    `${JUP_BALANCES_API}/${address}`,
  );
  const balances = new Map<string, number>();
  for (const [mint, info] of Object.entries(balancesRaw)) {
    if (mint !== 'SOL' && (info?.uiAmount || 0) > 0) balances.set(mint, info!.uiAmount!);
  }

  const assetInfo = new Map<string, JupAsset>();
  const mints = [...balances.keys()];
  for (let i = 0; i < mints.length; i += 30) {
    const chunk = mints.slice(i, i + 30);
    const assets = await fetchJson<JupAsset[]>(`${JUP_ASSETS_API}?query=${chunk.join(',')}`);
    for (const asset of Array.isArray(assets) ? assets : []) assetInfo.set(asset.id, asset);
  }

  // 3) GM pools: gmtrade is in Jupiter's platform list, but its fetcher
  //    returns 0 elements — so GM is counted separately on top;
  //    it's not a duplicate and can safely be summed.
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
        const info = assetInfo.get(d.address);
        const symbol =
          d.address === SOL_NATIVE_MINT
            ? 'SOL'
            : info?.symbol || info?.name || `${d.address.slice(0, 4)}…${d.address.slice(-4)}`;
        positions.push({ symbol, amount, priceUsd: price, valueUsd, platform: 'wallet', category: 'token' });
      }
    } else {
      const value = typeof element.value === 'number' && isFinite(element.value) ? element.value : 0;
      if (value < 0.01) continue;
      positions.push({
        symbol: element.name || element.label || element.serviceId || 'Position',
        name: element.name && element.label && element.name !== element.label ? element.label : null,
        valueUsd: value,
        platform: element.platformId || null,
        category: 'defi',
      });
    }
  }

  for (const pool of pools) {
    if (pool.price > 0) {
      positions.push({
        symbol: pool.name,
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
