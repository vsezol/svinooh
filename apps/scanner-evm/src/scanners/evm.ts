import { Logger } from '@nestjs/common';
import { enrich, NO_FACTS, option } from '@svinooh/common';
import type { ScanResult } from '@svinooh/shared';
import { evmFacts } from './defi';
import { EVM_SOURCES, type EvmSource } from './sources';

const logger = new Logger('EvmScanner');

/**
 * Which strategy answers this scan.
 *
 * Normally whichever the `scan.evmSource` setting names, read per scan so a
 * switch in the admin takes effect on the next wallet rather than the next
 * deploy.
 *
 * The exception is the first reading of an address nobody has scanned before.
 * Somebody has just pasted it and is watching a spinner, and the two strategies
 * are not close on how long that spinner lasts: measured on production wallets
 * the browser takes 6 to 20 seconds, and up to 49 on an empty address, while
 * the api answers in well under one. Nothing is traded away for it — there is
 * no stored value for a fresh reading to disagree with, and the configured
 * source corrects it on the next cycle anyway.
 *
 * If the api strategy cannot answer — no ZERION_API_KEY, or Zerion is down —
 * the configured source runs as it always would. A shortcut must never become
 * a new way to fail.
 */
function sourceFor(firstScan: boolean): { source: EvmSource; fallback: EvmSource | null } {
  const configured = EVM_SOURCES[option('scan.evmSource')];
  if (!firstScan || configured.id === 'api') return { source: configured, fallback: null };
  return { source: EVM_SOURCES.api, fallback: configured };
}

/**
 * One EVM scan: a strategy for the balances, and the protocols for what no
 * strategy reports.
 *
 * Whichever answered, Uniswap still decides whether a concentrated position is
 * inside its band from the pool's own tick, and Aave still says what a loan
 * costs. Neither adds a position or changes a value.
 *
 * The facts are gathered alongside the scan rather than after it: both are
 * slow, neither waits on the other, and a wallet with no Uniswap position and
 * no Aave debt costs one call per network to find that out.
 */
export async function scanEvm(
  address: string,
  firstScan = false,
  /** Told which source answered a first reading — the metric lives with the caller */
  onFirstReading?: (source: string) => void,
): Promise<ScanResult> {
  const { source, fallback } = sourceFor(firstScan);

  // Which one ANSWERED, not which one was asked — a fallback that logs the
  // name of the source it replaced is a log line that sends you the wrong way
  const read = async (): Promise<{ result: ScanResult; answered: EvmSource }> => {
    try {
      return { result: await source.read(address), answered: source };
    } catch (error) {
      if (!fallback) throw error;
      logger.warn(
        `${address}: ${source.label} could not answer a first scan (${(error as Error).message}) — falling back to ${fallback.label}`,
      );
      return { result: await fallback.read(address), answered: fallback };
    }
  };

  const [{ result, answered }, facts] = await Promise.all([
    read(),
    evmFacts(address).catch(() => NO_FACTS),
  ]);

  if (firstScan) {
    logger.log(`${address}: first reading via ${answered.label}`);
    onFirstReading?.(answered.id);
  }
  return { ...result, positions: enrich(result.positions, facts) };
}
