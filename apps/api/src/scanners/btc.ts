import { fetchJson } from './http';
import type { ScanResult } from './types';

interface MempoolAddressStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
}

interface MempoolAddress {
  chain_stats: MempoolAddressStats;
  mempool_stats: MempoolAddressStats;
}

/**
 * BTC через mempool.space — публичный API без ключей, созданный ровно для
 * этого. Blockchair не используется: без ключа банит по IP (430).
 * Запасной вариант с идентичным форматом ответа — blockstream.info/api.
 */
export async function scanBtc(address: string): Promise<ScanResult> {
  const [addr, prices] = await Promise.all([
    fetchJson<MempoolAddress>(`https://mempool.space/api/address/${address}`),
    fetchJson<{ USD: number }>('https://mempool.space/api/v1/prices'),
  ]);

  const btcUsd = prices.USD;
  // Подтверждённое + из мемпула — то, что кошельки показывают как «баланс»
  const sats =
    (addr.chain_stats.funded_txo_sum - addr.chain_stats.spent_txo_sum) +
    (addr.mempool_stats.funded_txo_sum - addr.mempool_stats.spent_txo_sum);
  const btc = sats / 1e8;
  const usd = btc * btcUsd;

  return {
    chain: 'BTC',
    address,
    totalUsd: usd,
    positions: [
      { symbol: 'BTC', amount: btc, priceUsd: btcUsd, valueUsd: usd, platform: 'wallet', category: 'token' },
    ],
  };
}
