import type { Chain } from '@svinooh/shared';
import { config } from '../config';
import { Semaphore } from '../scanners/semaphore';

/**
 * EVM now goes primarily over HTTP (debank reverse-signature), so it can run
 * with a small pool rather than strictly one at a time. The "never two headless
 * Chrome at once" guarantee is held by a separate lock inside evm-browser.ts —
 * which was the cause of the silent $0 with parallel instances.
 */
class ScanQueue {
  private readonly evm = new Semaphore(config.evmHttpConcurrency);
  private readonly http = new Semaphore(config.httpConcurrency);

  run<T>(chain: Chain, fn: () => Promise<T>): Promise<T> {
    return (chain === 'EVM' ? this.evm : this.http).run(fn);
  }
}

export const scanQueue = new ScanQueue();
