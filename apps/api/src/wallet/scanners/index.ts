import type { Chain } from '@svinooh/shared';
import { scanBtc } from './btc';

import { scanSol } from './sol';
import { scanTron } from './tron';
import type { ScanResult } from '@svinooh/shared';

export type { ScanPosition, ScanResult } from '@svinooh/shared';

/**
 * The network each of these chains scans is the chain itself — there is one
 * Solana, one Tron, one Bitcoin — so it is stamped here rather than repeated at
 * every place a position is built. EVM is the only family with more than one
 * network under it, and its scanner names them per position.
 */
const OWN_NETWORK: Partial<Record<Chain, string>> = { SOL: 'sol', TRON: 'tron', BTC: 'btc' };

/** Fills in the network for a chain that only has the one */
async function withNetwork(chain: Chain, scan: Promise<ScanResult>): Promise<ScanResult> {
  const network = OWN_NETWORK[chain];
  const result = await scan;
  if (!network) return result;
  return {
    ...result,
    positions: result.positions.map((p) => ({ ...p, network: p.network ?? network })),
  };
}

/**
 * `resourcesAt` is TRON's alone: it says when that address's resources were last
 * read, so the scan can decide whether it owes the extra rate-limited calls this
 * time. Every other chain ignores it.
 */
export function scanAddress(
  chain: Chain,
  address: string,
  resourcesAt?: string | null,
): Promise<ScanResult> {
  switch (chain) {
    case 'BTC':
      return withNetwork(chain, scanBtc(address));
    case 'EVM':
      // Scanned by apps/scanner-evm, off its own queue — this service never
      // calls it directly
      throw new Error('EVM is scanned by the scanner-evm service, not here');
    case 'SOL':
      return withNetwork(chain, scanSol(address));
    case 'TRON':
      return withNetwork(chain, scanTron(address, resourcesAt ?? null));
  }
}
