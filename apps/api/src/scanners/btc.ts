import { fetchJson } from './http';
import type { ScanResult } from './types';

interface AddressStats {
  funded_txo_sum: number;
  spent_txo_sum: number;
}

interface AddressResponse {
  chain_stats: AddressStats;
  mempool_stats: AddressStats;
}

/**
 * BTC: mempool.space — a keyless public API. From datacenter IPs (Railway)
 * mempool.space is sometimes unreachable (fetch failed), so there's a fallback
 * source with an identical format — blockstream.info. BTC price: mempool
 * /prices first, and on failure DefiLlama (the same source used for TRON).
 */
async function fetchAddress(address: string): Promise<AddressResponse> {
  try {
    return await fetchJson<AddressResponse>(`https://mempool.space/api/address/${address}`);
  } catch {
    // fallback: identical response format
    return fetchJson<AddressResponse>(`https://blockstream.info/api/address/${address}`);
  }
}

async function fetchBtcUsd(): Promise<number> {
  try {
    const prices = await fetchJson<{ USD: number }>('https://mempool.space/api/v1/prices');
    if (prices.USD > 0) return prices.USD;
  } catch {
    // fallback price source below
  }
  const { coins } = await fetchJson<{ coins: Record<string, { price: number }> }>(
    'https://coins.llama.fi/prices/current/coingecko:bitcoin',
  );
  return coins['coingecko:bitcoin']?.price || 0;
}

export async function scanBtc(address: string): Promise<ScanResult> {
  const [addr, btcUsd] = await Promise.all([fetchAddress(address), fetchBtcUsd()]);

  // Confirmed + mempool — what wallets show as the "balance"
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
