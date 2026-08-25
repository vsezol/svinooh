import type { Chain } from '@svinooh/shared';
import { scanBtc } from './btc';
import { scanEvm } from './evm';
import { scanSol } from './sol';
import { scanTron } from './tron';
import type { ScanResult } from './types';

export { detectChain } from './detect';
export type { ScanPosition, ScanResult } from './types';

export function scanAddress(chain: Chain, address: string): Promise<ScanResult> {
  switch (chain) {
    case 'BTC':
      return scanBtc(address);
    case 'EVM':
      return scanEvm(address);
    case 'SOL':
      return scanSol(address);
    case 'TRON':
      return scanTron(address);
  }
}
