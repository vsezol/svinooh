import type { Chain } from '@svinooh/shared';
import { Semaphore, setting } from '@svinooh/common';

/**
 * How many of this service's own scans run at once. EVM is not among them — it
 * is scanned by apps/scanner-evm, which paces itself off its own queue.
 */
class ScanQueue {
  private readonly http = new Semaphore(setting('scan.httpConcurrency'));

  run<T>(_chain: Chain, fn: () => Promise<T>): Promise<T> {
    return this.http.run(fn);
  }
}

export const scanQueue = new ScanQueue();
