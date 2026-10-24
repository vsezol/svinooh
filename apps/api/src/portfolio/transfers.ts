import { Logger } from '@nestjs/common';
import type { Chain, TransferDto, TransfersDto } from '@svinooh/shared';
import { readTransfers, type Transfer } from './transfer-sources';

const logger = new Logger('Transfers');

export interface HeldAddress {
  /** PortfolioWallet id — what WalletDto.id is */
  id: string;
  chain: Chain;
  address: string;
}

const TTL_MS = 10 * 60_000;

// ponytail: in-process cache, fine on one api replica; a table with a cursor
// when the list needs depth or the chart needs the numbers
const cache = new Map<string, { at: number; read: Promise<Transfer[]> }>();

function cachedRead(chain: Chain, address: string): Promise<Transfer[]> {
  const key = `${chain}:${address}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.at < TTL_MS) return hit.read;

  for (const [k, v] of cache) if (now - v.at >= TTL_MS) cache.delete(k);
  const read = readTransfers(chain, address);
  cache.set(key, { at: now, read });
  read.catch((error: Error) => {
    cache.delete(key);
    logger.warn(`${chain} ${address.slice(0, 8)}… transfers unread: ${error.message}`);
  });
  return read;
}

export async function portfolioTransfers(wallets: HeldAddress[]): Promise<TransfersDto> {
  const reads = await Promise.allSettled(wallets.map((w) => cachedRead(w.chain, w.address)));
  const read = wallets.flatMap((wallet, i) => {
    const result = reads[i];
    return result.status === 'fulfilled' ? [{ wallet, transfers: result.value }] : [];
  });
  return {
    transfers: crossings(read, wallets),
    unread: wallets.filter((_, i) => reads[i].status === 'rejected').map((w) => w.id),
  };
}

const spell = (address: string): string => (address.startsWith('0x') ? address.toLowerCase() : address);

/**
 * What crossed the portfolio's edge: every transfer whose other side is not one
 * of the portfolio's own addresses, one row per wallet, transaction and
 * direction. A transfer between two of its wallets is a move, not money in or out.
 */
export function crossings(
  read: Array<{ wallet: HeldAddress; transfers: Transfer[] }>,
  perimeter: HeldAddress[],
): TransferDto[] {
  const own = new Set(perimeter.map((w) => spell(w.address)));
  const rows = new Map<string, TransferDto>();

  for (const { wallet, transfers } of read) {
    for (const t of transfers) {
      if (t.counterparty && own.has(spell(t.counterparty))) continue;
      const key = `${wallet.id}:${t.txHash}:${t.direction}`;
      const leg = { symbol: t.symbol, amount: t.amount, usd: t.usd };
      const row = rows.get(key);
      if (row) {
        row.legs.push(leg);
        row.usd += t.usd;
        continue;
      }
      rows.set(key, {
        direction: t.direction,
        t: t.at.toISOString(),
        walletId: wallet.id,
        chain: wallet.chain,
        network: t.network,
        txHash: t.txHash,
        counterparty: t.counterparty,
        usd: t.usd,
        legs: [leg],
      });
    }
  }

  return [...rows.values()].sort((a, b) => b.t.localeCompare(a.t));
}
