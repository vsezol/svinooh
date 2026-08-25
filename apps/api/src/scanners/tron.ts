import { fetchJson } from './http';
import type { ScanPosition, ScanResult } from './types';

/**
 * TRON: TronGrid (официальный публичный API) для балансов, DefiLlama для цен.
 *
 * Главная грабля: застейканный TRX (Stake 2.0) не лежит в `balance` вообще —
 * у контрольного кошелька 99.9% баланса было в стейке, и без этих полей он
 * показывал $3.54 вместо $3 749. Принципал хранится в frozenV2 +
 * delegated_frozenV2_*. Поля acquired_delegated_* исключены сознательно:
 * это ресурсы, одолженные ИЗВНЕ, чужой TRX. Сверять против Tronscan
 * («Available + Staked»).
 */
export async function scanTron(address: string): Promise<ScanResult> {
  const { data } = await fetchJson<{ data?: Array<Record<string, any>> }>(
    `https://api.trongrid.io/v1/accounts/${address}`,
  );
  const account = data?.[0];
  if (!account) return { chain: 'TRON', address, totalUsd: 0, positions: [] };

  const stakedSun =
    ((account.frozenV2 as Array<{ amount?: number }> | undefined) || []).reduce(
      (sum, f) => sum + (f.amount || 0),
      0,
    ) +
    (account.account_resource?.delegated_frozenV2_balance_for_energy || 0) +
    (account.account_resource?.delegated_frozenV2_balance_for_bandwidth || 0) +
    (account.delegated_frozenV2_balance_for_bandwidth || 0);
  const liquidSun = account.balance || 0;

  const trc20: Array<Record<string, string>> = account.trc20 || [];
  const trc10: Array<{ key: string }> = account.assetV2 || [];

  const priceIds = ['coingecko:tron', ...trc20.map((t) => `tron:${Object.keys(t)[0]}`)];
  const { coins } = await fetchJson<{
    coins: Record<string, { price: number; symbol: string; decimals: number }>;
  }>(`https://coins.llama.fi/prices/current/${priceIds.join(',')}`);

  const trxPrice = coins['coingecko:tron']?.price || 0;
  const liquid = liquidSun / 1e6;
  const staked = stakedSun / 1e6;

  const positions: ScanPosition[] = [];
  if (liquid > 0 || staked === 0) {
    positions.push({
      symbol: 'TRX',
      amount: liquid,
      priceUsd: trxPrice,
      valueUsd: liquid * trxPrice,
      platform: 'wallet',
      category: 'token',
    });
  }
  if (staked > 0) {
    positions.push({
      symbol: 'TRX',
      name: 'В стейке (Stake 2.0)',
      amount: staked,
      priceUsd: trxPrice,
      valueUsd: staked * trxPrice,
      platform: 'stake',
      category: 'staked',
    });
  }

  const unpriced: string[] = [];
  for (const entry of trc20) {
    const [contract, rawAmount] = Object.entries(entry)[0];
    const coin = coins[`tron:${contract}`];
    if (!coin) {
      // Нет бесплатного источника цены — не молча съедаем, а показываем
      unpriced.push(`TRC20 ${contract}`);
      continue;
    }
    const amount = Number(rawAmount) / 10 ** coin.decimals;
    positions.push({
      symbol: coin.symbol,
      amount,
      priceUsd: coin.price,
      valueUsd: amount * coin.price,
      platform: 'wallet',
      category: 'token',
    });
  }
  // Legacy TRC10 — только числовой ID, без contract address: бесплатного
  // источника цен нет, логируем факт пропуска
  for (const asset of trc10) unpriced.push(`TRC10 #${asset.key}`);

  const totalUsd = positions.reduce((sum, p) => sum + p.valueUsd, 0);
  return {
    chain: 'TRON',
    address,
    totalUsd,
    positions,
    unpriced: unpriced.length ? unpriced : undefined,
  };
}
