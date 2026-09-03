import { enrich, NO_FACTS, option } from '@svinooh/common';
import type { ScanResult } from '@svinooh/shared';
import { evmFacts } from './defi';
import { EVM_SOURCES } from './sources';

/**
 * One EVM scan: a source for the balances, and the protocols for what no source
 * reports.
 *
 * The source is whichever the `scan.evmSource` setting names — see
 * scanners/sources. Whichever answered, Uniswap still decides whether a
 * concentrated position is inside its band from the pool's own tick, and Aave
 * still says what a loan costs. Neither adds a position or changes a value.
 *
 * The facts are gathered alongside the scan rather than after it: both are
 * slow, neither waits on the other, and a wallet with no Uniswap position and
 * no Aave debt costs one call per network to find that out.
 */
export async function scanEvm(address: string): Promise<ScanResult> {
  // Read per scan, not once at boot: switching the source in the admin takes
  // effect on the next wallet, not on the next deploy
  const source = EVM_SOURCES[option('scan.evmSource')];

  const [result, facts] = await Promise.all([
    source.read(address),
    evmFacts(address).catch(() => NO_FACTS),
  ]);

  return { ...result, positions: enrich(result.positions, facts) };
}
