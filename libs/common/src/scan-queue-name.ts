import type { Chain } from '@svinooh/shared';

/**
 * One queue per chain: `scan.evm`, `scan.sol`, `scan.tron`, `scan.btc`.
 *
 * They pace differently — an EVM scan is a browser and takes seconds, a BTC
 * scan is one request — and a single queue makes the slowest chain the speed of
 * all of them. Separate queues also mean a chain whose source is down backs up
 * on its own instead of holding up the others.
 */
export function scanQueueName(chain: Chain): string {
  return `scan.${chain.toLowerCase()}`;
}
