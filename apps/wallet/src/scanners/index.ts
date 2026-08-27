import type { Chain } from '@svinooh/shared';
import { scanBtc } from './btc';
import { scanEvmRemote } from './evm-remote';
import { scanSol } from './sol';
import { scanTron } from './tron';
import type { ScanResult } from '@svinooh/shared';

export type { ScanPosition, ScanResult } from '@svinooh/shared';

export function scanAddress(chain: Chain, address: string): Promise<ScanResult> {
  switch (chain) {
    case 'BTC':
      return scanBtc(address);
    case 'EVM':
      return scanEvmRemote(address);
    case 'SOL':
      return scanSol(address);
    case 'TRON':
      return scanTron(address);
  }
}
