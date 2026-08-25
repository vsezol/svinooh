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
 * BTC: mempool.space — публичный API без ключей. С датацентровых IP (Railway)
 * mempool.space иногда недоступен (fetch failed), поэтому есть запасной
 * источник с идентичным форматом — blockstream.info. Цена BTC: сначала
 * mempool /prices, при сбое — DefiLlama (тот же источник, что для TRON).
 */
async function fetchAddress(address: string): Promise<AddressResponse> {
  try {
    return await fetchJson<AddressResponse>(`https://mempool.space/api/address/${address}`);
  } catch {
    // запасной: идентичный формат ответа
    return fetchJson<AddressResponse>(`https://blockstream.info/api/address/${address}`);
  }
}

async function fetchBtcUsd(): Promise<number> {
  try {
    const prices = await fetchJson<{ USD: number }>('https://mempool.space/api/v1/prices');
    if (prices.USD > 0) return prices.USD;
  } catch {
    // ниже — запасной источник цены
  }
  const { coins } = await fetchJson<{ coins: Record<string, { price: number }> }>(
    'https://coins.llama.fi/prices/current/coingecko:bitcoin',
  );
  return coins['coingecko:bitcoin']?.price || 0;
}

export async function scanBtc(address: string): Promise<ScanResult> {
  const [addr, btcUsd] = await Promise.all([fetchAddress(address), fetchBtcUsd()]);

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
