import { Contract, formatUnits } from 'ethers';
import type { LendingFact } from '@svinooh/shared';
import { NETWORKS, withRpc, type NetworkKey } from './evm-rpc';

/**
 * Aave V3 pools, by network. Read straight off the contracts with a handful of
 * ABI lines rather than through `@aave/contract-helpers`, which would pull in
 * ethers v5 and a large address book to answer two questions. These addresses
 * are public, canonical and do not move.
 */
const POOLS: Partial<Record<NetworkKey, string>> = {
  eth: '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2',
  arb: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
  base: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5',
  polygon: '0x794a61358D6845594F94dc1DB02A252b5b4814aD',
};

const POOL_ABI = [
  'function getUserAccountData(address) view returns (uint256 totalCollateralBase,uint256 totalDebtBase,uint256 availableBorrowsBase,uint256 currentLiquidationThreshold,uint256 ltv,uint256 healthFactor)',
  'function getReservesList() view returns (address[])',
  'function getReserveData(address) view returns (tuple(uint256 configuration) configuration,uint128 liquidityIndex,uint128 currentLiquidityRate,uint128 variableBorrowIndex,uint128 currentVariableBorrowRate,uint128 currentStableBorrowRate,uint40 lastUpdateTimestamp,uint16 id,address aTokenAddress,address stableDebtTokenAddress,address variableDebtTokenAddress,address interestRateStrategyAddress,uint128 accruedToTreasury,uint128 unbacked,uint128 isolationModeTotalDebt)',
];
const ERC20_ABI = [
  'function symbol() view returns (string)',
  'function balanceOf(address) view returns (uint256)',
];

/**
 * A network's reserves, and the debt token that says whether a wallet borrowed
 * one. The list and its addresses change when a market is listed — rarely — so
 * they are fetched once an hour rather than once per wallet. What is left per
 * scan is one balance per reserve, which is the part that is actually about
 * this wallet.
 */
interface Reserve {
  asset: string;
  debtToken: string;
  symbol: string;
}

const reserveCache = new Map<NetworkKey, { at: number; reserves: Reserve[] }>();
const RESERVES_TTL_MS = 60 * 60 * 1000;

async function reservesOf(
  key: NetworkKey,
  pool: Contract,
  provider: ConstructorParameters<typeof Contract>[2],
): Promise<Reserve[]> {
  const cached = reserveCache.get(key);
  if (cached && Date.now() - cached.at < RESERVES_TTL_MS) return cached.reserves;

  const assets = (await pool.getReservesList()) as string[];
  const reserves = await Promise.all(
    assets.map(async (asset) => {
      const [data, symbol] = await Promise.all([
        pool.getReserveData(asset),
        new Contract(asset, ERC20_ABI, provider).symbol() as Promise<string>,
      ]);
      return {
        asset,
        debtToken: data.variableDebtTokenAddress as string,
        symbol: symbol.trim().toUpperCase(),
      };
    }),
  );
  reserveCache.set(key, { at: Date.now(), reserves });
  return reserves;
}

/** A rate in ray (1e27) as a percentage: 0.062e27 becomes 6.2 */
function rayToPercent(ray: bigint): number {
  return Math.round((Number(formatUnits(ray, 27)) * 100 + Number.EPSILON) * 100) / 100;
}

async function loansOn(key: NetworkKey, address: string): Promise<LendingFact[]> {
  const poolAddress = POOLS[key];
  if (!poolAddress) return [];
  const label = NETWORKS.find((n) => n.key === key)?.label ?? key;

  return withRpc(key, async (provider) => {
    const pool = new Contract(poolAddress, POOL_ABI, provider);
    const account = await pool.getUserAccountData(address);

    // Nothing borrowed is nothing to watch: no liquidation to approach and no
    // rate to climb
    if ((account.totalDebtBase as bigint) === 0n) return [];
    const healthFactor = Number(formatUnits(account.healthFactor as bigint, 18));
    if (!Number.isFinite(healthFactor) || healthFactor <= 0) return [];

    // Health is account-level on Aave — one number for the whole network — but
    // the rate is per asset, so a fact is made per asset actually borrowed. The
    // debt token's balance is what says which those are, and the rate is only
    // fetched for the ones that came back owing something.
    const reserves = await reservesOf(key, pool, provider);
    const owing = await Promise.all(
      reserves.map(async (reserve) => {
        const debtToken = new Contract(reserve.debtToken, ERC20_ABI, provider);
        const owed = (await debtToken.balanceOf(address)) as bigint;
        return owed === 0n ? null : reserve;
      }),
    );

    const facts = await Promise.all(
      owing
        .filter((r): r is Reserve => r !== null)
        .map(async (reserve): Promise<LendingFact> => {
          const data = await pool.getReserveData(reserve.asset);
          return {
            id: `aave:${key}:${reserve.asset.toLowerCase()}`,
            platform: 'aave',
            market: `Aave V3 ${label}`,
            token: reserve.symbol,
            healthFactor: Math.round(healthFactor * 100) / 100,
            borrowRate: rayToPercent(data.currentVariableBorrowRate as bigint),
          };
        }),
    );
    return facts;
  });
}

/**
 * What a wallet owes Aave on each network, and the networks that could not be
 * reached.
 *
 * DeBank already reports a health factor for most lending positions; what it
 * does not report anywhere is what the loan costs. That is the gap this fills,
 * so the borrow-rate threshold in the alert settings has something to fire on.
 */
export async function aaveLending(address: string): Promise<{ lending: LendingFact[]; failed: string[] }> {
  const lending: LendingFact[] = [];
  const failed: string[] = [];
  await Promise.all(
    NETWORKS.map(async (network) => {
      try {
        lending.push(...(await loansOn(network.key, address)));
      } catch {
        failed.push(`aave:${network.key}`);
      }
    }),
  );
  return { lending, failed };
}
