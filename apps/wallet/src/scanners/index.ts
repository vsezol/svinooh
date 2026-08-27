import type { Chain } from '@svinooh/shared';
import { scanBtc } from './btc';

import { scanSol } from './sol';
import { scanTron } from './tron';
import type { ScanResult } from '@svinooh/shared';

export type { ScanPosition, ScanResult } from '@svinooh/shared';

export function scanAddress(chain: Chain, address: string): Promise<ScanResult> {
  switch (chain) {
    case 'BTC':
      return scanBtc(address);
    case 'EVM':
      // Scanned by apps/scanner-evm, off its own queue — this service never
      // calls it directly
      throw new Error('EVM is scanned by the scanner-evm service, not here');
    case 'SOL':
      return scanSol(address);
    case 'TRON':
      return scanTron(address);
  }
}
