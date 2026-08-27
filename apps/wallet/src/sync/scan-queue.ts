import type { Chain } from '@svinooh/shared';
import { config } from '../config';
import { Semaphore } from '@svinooh/common';

/**
 * How many scans this service runs at once. EVM is one call out to the scanner
 * service, which does its own pacing and holds its own browser lock, so there
 * is nothing to serialise here beyond not asking it for ten things at once.
 */
class ScanQueue {
  private readonly evm = new Semaphore(config.evmConcurrency);
  private readonly http = new Semaphore(config.httpConcurrency);

  run<T>(chain: Chain, fn: () => Promise<T>): Promise<T> {
    return (chain === 'EVM' ? this.evm : this.http).run(fn);
  }
}

export const scanQueue = new ScanQueue();
