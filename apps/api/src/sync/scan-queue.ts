import type { Chain } from '@svinooh/shared';
import { config } from '../config';
import { Semaphore } from '../scanners/semaphore';

/**
 * EVM теперь первично ходит по HTTP (debank реверс-подпись), поэтому его
 * можно гнать небольшим пулом, а не строго по одному. Гарантию «никогда не
 * два headless Chrome разом» держит отдельный лок внутри evm-browser.ts —
 * он и был причиной молчаливых $0 при параллельных инстансах.
 */
class ScanQueue {
  private readonly evm = new Semaphore(config.evmHttpConcurrency);
  private readonly http = new Semaphore(config.httpConcurrency);

  run<T>(chain: Chain, fn: () => Promise<T>): Promise<T> {
    return (chain === 'EVM' ? this.evm : this.http).run(fn);
  }
}

export const scanQueue = new ScanQueue();
