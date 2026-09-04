import { Logger } from '@nestjs/common';
import { JsonRpcProvider } from 'ethers';

const logger = new Logger('EvmRpc');

/** The networks worth asking, and the keyless nodes to ask */
export const NETWORKS = [
  {
    key: 'eth',
    label: 'Ethereum',
    rpcs: [
      'https://ethereum-rpc.publicnode.com',
      'https://cloudflare-eth.com',
      'https://eth.llamarpc.com',
    ],
  },
  {
    key: 'arb',
    label: 'Arbitrum',
    rpcs: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one.publicnode.com'],
  },
  {
    key: 'base',
    label: 'Base',
    rpcs: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
  },
  {
    key: 'polygon',
    label: 'Polygon',
    rpcs: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon-rpc.com'],
  },
] as const;

export type NetworkKey = (typeof NETWORKS)[number]['key'];

/**
 * Per-attempt timeout. ethers has no request timeout of its own, so one node
 * that accepts the connection and then thinks forever would hold the whole
 * fallback chain — and with it the scan. Cap the attempt and move to the next
 * node instead.
 */
const ATTEMPT_TIMEOUT_MS = 15_000;

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`RPC timed out after ${ATTEMPT_TIMEOUT_MS}ms (${label})`)), ATTEMPT_TIMEOUT_MS),
    ),
  ]);
}

/** An override for one network's nodes: EVM_RPC_ARB=https://…,https://… */
function rpcsFor(key: NetworkKey): readonly string[] {
  const override = (process.env[`EVM_RPC_${key.toUpperCase()}`] ?? '')
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
  const network = NETWORKS.find((n) => n.key === key);
  return override.length ? override : (network?.rpcs ?? []);
}

/**
 * Runs a read against the first node that answers.
 *
 * Public nodes rate-limit, go down and occasionally lie about supporting a
 * method, so the list is walked rather than trusted. Throws only when every one
 * of them failed, which is the case where we genuinely know nothing about this
 * network and the caller has to say so rather than report an empty result.
 */
export async function withRpc<T>(key: NetworkKey, read: (provider: JsonRpcProvider) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const url of rpcsFor(key)) {
    // batchMaxCount: ethers batches up to 100 calls per request by default, and
    // mainnet.base.org refuses more than 10 — so every Base read failed on it
    // and fell through to the next node. Not a broken node: a batch it will not
    // take. Capping restores Base to two working nodes instead of one.
    const provider = new JsonRpcProvider(url, undefined, {
      staticNetwork: true,
      batchMaxCount: 10,
    });
    try {
      return await withTimeout(read(provider), url);
    } catch (error) {
      lastError = error;
      logger.debug(`${key} via ${url} failed: ${(error as Error).message}`);
    } finally {
      provider.destroy();
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${key}: every RPC failed`);
}
