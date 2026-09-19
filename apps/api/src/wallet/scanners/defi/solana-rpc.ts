import { Logger } from '@nestjs/common';
import { sleep } from '@svinooh/common';

const logger = new Logger('SolanaRpc');

/**
 * Solana JSON-RPC with a list to fall back through.
 *
 * Only Orca needs this — it has to find the wallet's position NFTs before it can
 * ask about them, and there is no HTTP endpoint that will do it. Many public
 * nodes refuse `getTokenAccountsByOwner` with a program filter outright, which
 * is why this walks a list twice rather than trusting one: the first refusal is
 * not a signal that the wallet has no positions.
 *
 * Set SOLANA_RPC_URL (comma-separated) to a private endpoint and it goes first.
 */
const ENV_RPCS = (process.env.SOLANA_RPC_URL ?? '')
  .split(',')
  .map((url) => url.trim())
  .filter(Boolean);

const RPCS = [
  ...ENV_RPCS,
  // solana.lava.build was here, and answered "This endpoint has been
  // discontinued" to every call. Being first in the list, it cost two wasted
  // round-trips on every Orca lookup and filled the log with a failure that
  // meant nothing — which is how a failure that means something gets missed.
  'https://rpc.magicblock.app/mainnet',
  'https://api.mainnet-beta.solana.com',
  'https://solana-rpc.publicnode.com',
];

const ROUNDS = 2;
const TIMEOUT_MS = 30_000;

export async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  let lastError: unknown;
  for (let round = 0; round < ROUNDS; round++) {
    if (round > 0) await sleep(2000);
    for (const url of RPCS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        const data = (await res.json()) as { result?: T; error?: unknown };
        if (data.error) throw new Error(`${method}: ${JSON.stringify(data.error)}`);
        return data.result as T;
      } catch (error) {
        lastError = error;
        logger.debug(`${method} via ${url} failed: ${(error as Error).message}`);
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${method}: every RPC refused`);
}
