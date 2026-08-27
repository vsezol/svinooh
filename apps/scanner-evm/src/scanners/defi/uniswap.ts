import { Contract } from 'ethers';
import type { PoolFact } from '@svinooh/shared';
import { NETWORKS, withRpc, type NetworkKey } from './evm-rpc';
import { pairKey } from '@svinooh/common';

/** Canonical Uniswap V3 deployments on the networks svinooh already scans */
const DEPLOYMENTS: Partial<Record<NetworkKey, { positionManager: string; factory: string }>> = {
  eth: {
    positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  },
  arb: {
    positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  },
  base: {
    positionManager: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
    factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
  },
  polygon: {
    positionManager: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
  },
};

/**
 * A wallet with hundreds of positions would cost hundreds of round trips, and
 * the ones past this are not what somebody is watching for a range alert.
 */
const MAX_POSITIONS_PER_NETWORK = 25;

const POSITION_MANAGER_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function tokenOfOwnerByIndex(address,uint256) view returns (uint256)',
  'function positions(uint256) view returns (uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)',
];
const FACTORY_ABI = ['function getPool(address,address,uint24) view returns (address)'];
const POOL_ABI = [
  'function slot0() view returns (uint160 sqrtPriceX96,int24 tick,uint16 observationIndex,uint16 observationCardinality,uint16 observationCardinalityNext,uint8 feeProtocol,bool unlocked)',
];
const ERC20_ABI = ['function symbol() view returns (string)', 'function decimals() view returns (uint8)'];

/** A token's symbol and decimals never change, so they are asked for once per process */
const tokenMeta = new Map<string, { symbol: string; decimals: number }>();

async function metaOf(
  key: NetworkKey,
  provider: ConstructorParameters<typeof Contract>[2],
  address: string,
): Promise<{ symbol: string; decimals: number }> {
  const cacheKey = `${key}:${address.toLowerCase()}`;
  const cached = tokenMeta.get(cacheKey);
  if (cached) return cached;
  const erc20 = new Contract(address, ERC20_ABI, provider);
  const [symbol, decimals] = await Promise.all([
    erc20.symbol() as Promise<string>,
    erc20.decimals() as Promise<bigint>,
  ]);
  const meta = { symbol, decimals: Number(decimals) };
  tokenMeta.set(cacheKey, meta);
  return meta;
}

/** Price of token0 in units of token1, from the tick the pool is standing on */
function priceAt(tick: number, decimals0: number, decimals1: number): number {
  return Math.pow(1.0001, tick) * Math.pow(10, decimals0 - decimals1);
}

async function positionsOn(key: NetworkKey, address: string): Promise<PoolFact[]> {
  const deployment = DEPLOYMENTS[key];
  if (!deployment) return [];

  return withRpc(key, async (provider) => {
    const manager = new Contract(deployment.positionManager, POSITION_MANAGER_ABI, provider);
    const factory = new Contract(deployment.factory, FACTORY_ABI, provider);

    const balance = Number((await manager.balanceOf(address)) as bigint);
    if (balance === 0) return [];

    const count = Math.min(balance, MAX_POSITIONS_PER_NETWORK);
    const facts = await Promise.all(
      Array.from({ length: count }, async (_unused, i): Promise<PoolFact | null> => {
        const tokenId = (await manager.tokenOfOwnerByIndex(address, i)) as bigint;
        const position = await manager.positions(tokenId);
        // A position with no liquidity is closed; it has no band to leave
        if ((position.liquidity as bigint) === 0n) return null;

        const poolAddress = (await factory.getPool(position.token0, position.token1, position.fee)) as string;
        const pool = new Contract(poolAddress, POOL_ABI, provider);
        const [slot0, token0, token1] = await Promise.all([
          pool.slot0(),
          metaOf(key, provider, position.token0 as string),
          metaOf(key, provider, position.token1 as string),
        ]);

        const tick = Number(slot0.tick as bigint);
        const lower = Number(position.tickLower as bigint);
        const upper = Number(position.tickUpper as bigint);
        return {
          id: `uniswap:${key}:${tokenId.toString()}`,
          platform: 'uniswap',
          pair: pairKey(token0.symbol, token1.symbol),
          inRange: tick >= lower && tick < upper,
          lowerPrice: priceAt(lower, token0.decimals, token1.decimals),
          upperPrice: priceAt(upper, token0.decimals, token1.decimals),
          currentPrice: priceAt(tick, token0.decimals, token1.decimals),
          priceLabel: `${token1.symbol} per ${token0.symbol}`,
          isFullRange: false,
        };
      }),
    );
    return facts.filter((f): f is PoolFact => f !== null);
  });
}

/**
 * Uniswap V3 positions across every network, and the networks that could not be
 * reached.
 *
 * Whether a position is in range is the pool's own answer — its current tick
 * against the position's bounds — rather than an inference from which side of
 * the pair it is holding. Networks are asked in parallel: each is a chain of
 * slow round trips through a fallback list, so doing them one after another
 * would cost their sum instead of their slowest.
 */
export async function uniswapPools(address: string): Promise<{ pools: PoolFact[]; failed: string[] }> {
  const pools: PoolFact[] = [];
  const failed: string[] = [];
  await Promise.all(
    NETWORKS.map(async (network) => {
      try {
        pools.push(...(await positionsOn(network.key, address)));
      } catch {
        failed.push(`uniswap:${network.key}`);
      }
    }),
  );
  return { pools, failed };
}
