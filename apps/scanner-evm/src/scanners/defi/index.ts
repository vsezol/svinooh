import { Logger } from '@nestjs/common';
import type { DefiFacts } from '@svinooh/shared';
import { aaveLending } from './aave';
import { uniswapPools } from './uniswap';

const logger = new Logger('DefiFacts');

/**
 * The EVM protocols themselves, asked what DeBank does not report: whether a
 * Uniswap position is inside its band from the pool's own tick, and what an
 * Aave loan actually costs — a borrow rate DeBank carries nowhere, which is why
 * the borrow-rate threshold in the alert settings has had nothing to fire on.
 *
 * Uniswap is read across four networks through a list of public nodes, Aave
 * through its own API for every chain it is on. Both are allowed to fail, per
 * network or per version. What could not be reached is named in `failed`: it
 * told us nothing, which is not the same as telling us there is nothing there.
 */
export async function evmFacts(address: string): Promise<DefiFacts> {
  const [pools, lending] = await Promise.all([
    uniswapPools(address).catch((error: Error) => {
      logger.warn(`uniswap could not be read for ${address}: ${error.message}`);
      return { pools: [], failed: ['uniswap'] };
    }),
    aaveLending(address).catch((error: Error) => {
      logger.warn(`aave could not be read for ${address}: ${error.message}`);
      return { lending: [], failed: ['aave'] };
    }),
  ]);
  return {
    pools: pools.pools,
    lending: lending.lending,
    failed: [...pools.failed, ...lending.failed],
  };
}
