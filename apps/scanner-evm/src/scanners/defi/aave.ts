import { Logger } from '@nestjs/common';
import type { LendingFact } from '@svinooh/shared';

const logger = new Logger('Aave');

/**
 * Aave's own APIs, one per protocol version. Public, keyless, and each answers
 * for every chain and every market of its version in one request.
 *
 * This used to be the Pool contracts read through public nodes on four
 * networks. One token with a bytes32 symbol (MKR, listed on Ethereum) failed
 * the decode, took the whole Ethereum read down with it, and every Ethereum
 * loan went without a rate for two months while the error was swallowed. The
 * API also quotes the APY its own interface shows, where the contract gives
 * the APR underneath it.
 */
const V3_API = 'https://api.v3.aave.com/graphql';
const V4_API = 'https://api.v4.aave.com/graphql';

/**
 * Aave's chain ids as DeBank names the network. defi-facts folds Zerion's names
 * into these. A chain missing here is skipped: a fact with no network would be
 * handed to a loan on any chain.
 */
const NETWORK: Record<number, string> = {
  1: 'eth',
  10: 'op',
  56: 'bsc',
  100: 'xdai',
  137: 'matic',
  143: 'monad',
  146: 'sonic',
  196: 'xlayer',
  324: 'era',
  1088: 'metis',
  1868: 'soneium',
  4326: 'megaeth',
  5000: 'mnt',
  5042: 'arc',
  8453: 'base',
  9745: 'plasma',
  42161: 'arb',
  42220: 'celo',
  43114: 'avax',
  57073: 'ink',
  59144: 'linea',
  534352: 'scrl',
};

async function ask<T>(api: string, query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (!body.data || body.errors?.length) {
    throw new Error(body.errors?.[0]?.message ?? `HTTP ${response.status}`);
  }
  return body.data;
}

/**
 * The chains a version is live on, by its own API. Asked rather than listed:
 * V3 refuses the whole request over one chain id it does not serve, so a list
 * kept here would stop reading every chain the day Aave retires one.
 */
const chainCache = new Map<string, { at: number; ids: number[] }>();
const CHAINS_TTL_MS = 60 * 60 * 1000;

async function chainsOf(api: string, query: string): Promise<number[]> {
  const cached = chainCache.get(api);
  if (cached && Date.now() - cached.at < CHAINS_TTL_MS) return cached.ids;
  const { chains } = await ask<{ chains: Array<{ chainId: number }> }>(api, query);
  const ids = chains.map((c) => c.chainId).filter((id) => id in NETWORK);
  chainCache.set(api, { at: Date.now(), ids });
  return ids;
}

/** "AaveV3EthereumLido" as "Aave V3 Ethereum Lido" */
const spaced = (name: string): string => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface V3Market {
  name: string;
  address: string;
  chain: { chainId: number };
  userState: { healthFactor: string | null; totalDebtBase: string } | null;
}

interface V3Borrow {
  market: { address: string; chain: { chainId: number } };
  currency: { symbol: string };
  apy: { value: string };
}

async function v3Loans(user: string): Promise<LendingFact[]> {
  const chainIds = await chainsOf(V3_API, '{ chains(filter: MAINNET_ONLY) { chainId } }');
  const { markets } = await ask<{ markets: V3Market[] }>(
    V3_API,
    `query ($chainIds: [ChainId!]!, $user: EvmAddress!) {
      markets(request: { chainIds: $chainIds, user: $user }) {
        name address chain { chainId }
        userState { healthFactor totalDebtBase }
      }
    }`,
    { chainIds, user },
  );

  // Health is per market on Aave and the rate per asset, so the markets say
  // where there is debt at all and only those are asked what it costs
  const owing = markets.filter(
    (m) => m.userState?.healthFactor != null && Number(m.userState.totalDebtBase) > 0,
  );
  if (!owing.length) return [];

  const { userBorrows } = await ask<{ userBorrows: V3Borrow[] }>(
    V3_API,
    `query ($request: UserBorrowsRequest!) {
      userBorrows(request: $request) {
        market { address chain { chainId } }
        currency { symbol }
        apy { value }
      }
    }`,
    { request: { user, markets: owing.map((m) => ({ address: m.address, chainId: m.chain.chainId })) } },
  );

  return userBorrows.flatMap((borrow): LendingFact[] => {
    const chainId = borrow.market.chain.chainId;
    const pool = borrow.market.address.toLowerCase();
    const market = owing.find((m) => m.chain.chainId === chainId && m.address.toLowerCase() === pool);
    if (!market) return [];
    const token = borrow.currency.symbol.trim().toUpperCase();
    return [
      {
        id: `aave3:${chainId}:${pool}:${token}`,
        pool,
        network: NETWORK[chainId],
        platform: 'aave3',
        market: spaced(market.name),
        token,
        healthFactor: round2(Number(market.userState!.healthFactor)),
        borrowRate: round2(Number(borrow.apy.value) * 100),
      },
    ];
  });
}

interface V4Position {
  spoke: { address: string; displayName: string; chain: { chainId: number } };
  healthFactor: { current: string | null };
  totalDebt: { current: { value: string } };
}

interface V4Borrow {
  debt: { token: { info: { symbol: string } } };
  reserve: {
    spoke: { address: string; chain: { chainId: number } };
    userState: { borrowApy: { value: string } } | null;
    summary: { borrowApy: { value: string } };
  };
}

/**
 * V4 lends through spokes, each its own market with its own health factor, so
 * a spoke is what a V3 market is to a fact. The rate is read off the reserve as
 * it applies to this user, which is where V4 puts its per-user risk premium.
 */
async function v4Loans(user: string): Promise<LendingFact[]> {
  const chainIds = await chainsOf(
    V4_API,
    '{ chains(request: { query: { filter: MAINNET_ONLY } }) { chainId } }',
  );
  const { userPositions, userBorrows } = await ask<{ userPositions: V4Position[]; userBorrows: V4Borrow[] }>(
    V4_API,
    `query ($chainIds: [ChainId!]!, $user: EvmAddress!) {
      userPositions(request: { user: $user, filter: { chainIds: $chainIds } }) {
        spoke { address displayName chain { chainId } }
        healthFactor { current }
        totalDebt { current { value } }
      }
      userBorrows(request: { query: { userChains: { user: $user, chainIds: $chainIds } } }) {
        debt { token { info { symbol } } }
        reserve {
          spoke { address chain { chainId } }
          userState { borrowApy { value } }
          summary { borrowApy { value } }
        }
      }
    }`,
    { chainIds, user },
  );

  return userBorrows.flatMap((borrow): LendingFact[] => {
    const chainId = borrow.reserve.spoke.chain.chainId;
    const pool = borrow.reserve.spoke.address.toLowerCase();
    const position = userPositions.find(
      (p) => p.spoke.chain.chainId === chainId && p.spoke.address.toLowerCase() === pool,
    );
    if (position?.healthFactor.current == null) return [];
    const token = borrow.debt.token.info.symbol.trim().toUpperCase();
    const rate = borrow.reserve.userState?.borrowApy ?? borrow.reserve.summary.borrowApy;
    return [
      {
        id: `aave4:${chainId}:${pool}:${token}`,
        pool,
        network: NETWORK[chainId],
        platform: 'aave4',
        market: `Aave V4 ${position.spoke.displayName}`,
        token,
        healthFactor: round2(Number(position.healthFactor.current)),
        borrowRate: round2(Number(rate.value) * 100),
      },
    ];
  });
}

/**
 * What a wallet owes Aave, on every chain and in every market of both versions,
 * and the versions that could not be read.
 *
 * DeBank and Zerion report a health factor at best; what neither reports is
 * what the loan costs. That is the gap this fills, so the borrow-rate threshold
 * in the alert settings has something to fire on.
 */
export async function aaveLending(address: string): Promise<{ lending: LendingFact[]; failed: string[] }> {
  const lending: LendingFact[] = [];
  const failed: string[] = [];
  const versions = [
    ['aave3', v3Loans],
    ['aave4', v4Loans],
  ] as const;
  await Promise.all(
    versions.map(async ([version, read]) => {
      try {
        lending.push(...(await read(address)));
      } catch (error) {
        logger.warn(`${version} could not be read for ${address}: ${(error as Error).message}`);
        failed.push(version);
      }
    }),
  );
  return { lending, failed };
}
