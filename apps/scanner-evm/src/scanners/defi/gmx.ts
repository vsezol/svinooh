import { Logger } from '@nestjs/common';
import type { ScanPosition, ScanPositionToken } from '@svinooh/shared';

const logger = new Logger('Gmx');

const API: Record<string, string> = {
  arb: 'https://arbitrum-api.gmxinfra.io',
  avax: 'https://avalanche-api.gmxinfra.io',
};

const EARNINGS_API: Record<string, string> = {
  arb: 'https://arbitrum.gmxapi.io',
  avax: 'https://avalanche.gmxapi.io',
};

const MARKET_TOKEN_SYMBOL = /^GM\b/;

export interface GmxMarket {
  name: string;
  marketToken: string;
  longToken: string;
  shortToken: string;
  poolAmountLong: string;
  poolAmountShort: string;
}

export interface GmxToken {
  symbol: string;
  address: string;
  decimals: number;
}

export interface GmxTicker {
  tokenAddress: string;
  minPrice: string;
  maxPrice: string;
}

export interface GmxNetwork {
  markets: GmxMarket[];
  tokens: GmxToken[];
  tickers: GmxTicker[];
}

export async function withGmxPools(positions: ScanPosition[], address: string): Promise<ScanPosition[]> {
  return withFeesEarned(await asPools(positions), address);
}

export function withEarnings(position: ScanPosition, earnings: Map<string, number>): ScanPosition {
  const fees = earnings.get(marketOf(position) ?? '');
  return fees === undefined ? position : { ...position, feesEarnedUsd: fees };
}

export function gmPool(position: ScanPosition, gmx: GmxNetwork): ScanPosition | null {
  const address = position.ref?.toLowerCase();
  const market = gmx.markets.find((one) => one.marketToken.toLowerCase() === address);
  if (!market) return null;
  const long = tokenIn(gmx, market.longToken);
  const short = tokenIn(gmx, market.shortToken);
  if (!long || !short) return null;

  const value = position.valueUsd;
  const longPool = (Number(market.poolAmountLong) / 10 ** long.decimals) * long.price;
  const shortPool = (Number(market.poolAmountShort) / 10 ** short.decimals) * short.price;
  const sameToken = long.address === short.address;
  const longShare = sameToken || longPool + shortPool <= 0 ? 1 : longPool / (longPool + shortPool);
  const leg = (token: typeof long, usd: number): ScanPositionToken => ({
    symbol: token.symbol,
    amount: usd / token.price,
    priceUsd: token.price,
    valueUsd: usd,
    role: 'supply',
    network: position.network,
  });

  return {
    symbol: 'GMX V2',
    name: 'Liquidity Pool',
    note: market.name,
    network: position.network,
    pool: address,
    amount: position.amount,
    priceUsd: position.priceUsd,
    valueUsd: value,
    platform: 'gmx',
    category: 'defi',
    tokens: sameToken ? [leg(long, value)] : [leg(long, value * longShare), leg(short, value * (1 - longShare))],
  };
}

async function asPools(positions: ScanPosition[]): Promise<ScanPosition[]> {
  const networks = [...new Set(positions.filter(isMarketToken).map((position) => position.network!))];
  if (!networks.length) return positions;
  try {
    const read = new Map(
      await Promise.all(networks.map(async (network) => [network, await gmxNetwork(network)] as const)),
    );
    return positions.map(
      (position) => (isMarketToken(position) && gmPool(position, read.get(position.network!)!)) || position,
    );
  } catch (error) {
    logger.warn(`GMX markets could not be read: ${(error as Error).message}`);
    return positions;
  }
}

async function withFeesEarned(positions: ScanPosition[], address: string): Promise<ScanPosition[]> {
  const networks = [...new Set(positions.filter(isGmxPool).map((position) => position.network!))];
  if (!networks.length) return positions;
  try {
    const earned = new Map(
      await Promise.all(networks.map(async (network) => [network, await earningsOn(network, address)] as const)),
    );
    return positions.map((position) =>
      isGmxPool(position) ? withEarnings(position, earned.get(position.network!)!) : position,
    );
  } catch (error) {
    logger.warn(`GMX earnings of ${address} could not be read: ${(error as Error).message}`);
    return positions;
  }
}

function isGmxPool(position: ScanPosition): boolean {
  return (
    position.category !== 'token' &&
    !!position.network &&
    position.network in EARNINGS_API &&
    /gmx/i.test(`${position.platform} ${position.symbol}`) &&
    marketOf(position) !== null
  );
}

function marketOf(position: ScanPosition): string | null {
  return position.pool?.split(':')[0].toLowerCase() || null;
}

async function earningsOn(network: string, address: string): Promise<Map<string, number>> {
  const response = await fetch(`${EARNINGS_API[network]}/v1/yield/gm-user-earnings?account=${address}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${network} earnings answered ${response.status}`);
  const body = (await response.json()) as { pools: Array<{ marketToken: string; lifetimeFeeUsd: string }> };
  return new Map(body.pools.map((pool) => [pool.marketToken.toLowerCase(), Number(pool.lifetimeFeeUsd) / 1e30]));
}

function isMarketToken(position: ScanPosition): boolean {
  return (
    position.category === 'token' &&
    !!position.ref &&
    !!position.network &&
    position.network in API &&
    MARKET_TOKEN_SYMBOL.test(position.symbol)
  );
}

function tokenIn(gmx: GmxNetwork, address: string): (GmxToken & { price: number }) | null {
  const wanted = address.toLowerCase();
  const token = gmx.tokens.find((one) => one.address.toLowerCase() === wanted);
  const ticker = gmx.tickers.find((one) => one.tokenAddress.toLowerCase() === wanted);
  if (!token || !ticker) return null;
  const scale = 10 ** (30 - token.decimals);
  const price = (Number(ticker.minPrice) + Number(ticker.maxPrice)) / 2 / scale;
  return price > 0 ? { ...token, address: wanted, price } : null;
}

async function gmxNetwork(network: string): Promise<GmxNetwork> {
  const get = async <T>(path: string): Promise<T> => {
    const response = await fetch(`${API[network]}${path}`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${network} ${path} answered ${response.status}`);
    return (await response.json()) as T;
  };
  const [markets, tokens, tickers] = await Promise.all([
    get<{ markets: GmxMarket[] }>('/markets/info'),
    get<{ tokens: GmxToken[] }>('/tokens'),
    get<GmxTicker[]>('/prices/tickers'),
  ]);
  return { markets: markets.markets, tokens: tokens.tokens, tickers };
}
