import { fetchJson } from './http';
import type { ScanPosition, ScanPositionToken, ScanResult } from '@svinooh/shared';
import { config } from '../config';
import { getTronResources } from './tron-resources';

/**
 * Whether this scan should pay for a resource read.
 *
 * Resources are four or more sequential rate-limited calls and move on the scale
 * of a delegation lock, so they are refreshed on their own clock rather than on
 * every balance sync. Never read — always. Read once and gone stale — again.
 * Otherwise the stored snapshot stands.
 */
function resourcesDue(lastReadAt: string | null): boolean {
  if (!lastReadAt) return true;
  const at = Date.parse(lastReadAt);
  if (Number.isNaN(at)) return true;
  return Date.now() - at >= config.tronResourceIntervalMin * 60_000;
}

/**
 * TRON: TronGrid (the official public API) for balances, DefiLlama for prices.
 *
 * The main gotcha: staked TRX (Stake 2.0) doesn't sit in `balance` at all —
 * on the reference wallet 99.9% of the balance was staked, and without these
 * fields it showed $3.54 instead of $3,749. The principal lives in frozenV2 +
 * delegated_frozenV2_*. The acquired_delegated_* fields are excluded on purpose:
 * those are resources borrowed from OUTSIDE, someone else's TRX. Reconcile
 * against Tronscan ("Available + Staked").
 */
export async function scanTron(address: string, resourcesAt: string | null = null): Promise<ScanResult> {
  const { data } = await fetchJson<{ data?: Array<Record<string, any>> }>(
    `https://api.trongrid.io/v1/accounts/${address}`,
  );
  const account = data?.[0];
  if (!account) return { chain: 'TRON', address, totalUsd: 0, positions: [] };

  // Where the staked TRX sits, kept split so the position can show its legs:
  // frozen for oneself (by resource) and frozen-and-delegated to someone else
  const frozenV2 = (account.frozenV2 as Array<{ type?: string; amount?: number }> | undefined) || [];
  const stakeParts: Array<{ label: string; sun: number }> = [];
  for (const frozen of frozenV2) {
    // an entry with no `type` is BANDWIDTH — that's how TronGrid encodes it
    stakeParts.push({ label: `Frozen for ${(frozen.type || 'BANDWIDTH').toLowerCase()}`, sun: frozen.amount || 0 });
  }
  const delegatedSun =
    (account.account_resource?.delegated_frozenV2_balance_for_energy || 0) +
    (account.account_resource?.delegated_frozenV2_balance_for_bandwidth || 0) +
    (account.delegated_frozenV2_balance_for_bandwidth || 0);
  if (delegatedSun > 0) stakeParts.push({ label: 'Delegated to others', sun: delegatedSun });

  const stakedSun = stakeParts.reduce((sum, p) => sum + p.sun, 0);
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
    const legs: ScanPositionToken[] = stakeParts
      .filter((part) => part.sun > 0)
      .map((part) => ({
        symbol: `TRX · ${part.label}`,
        amount: part.sun / 1e6,
        priceUsd: trxPrice,
        valueUsd: (part.sun / 1e6) * trxPrice,
        role: 'supply' as const,
      }));
    positions.push({
      symbol: 'TRX',
      name: 'Staked',
      note: 'Stake 2.0',
      amount: staked,
      priceUsd: trxPrice,
      valueUsd: staked * trxPrice,
      platform: 'stake',
      category: 'staked',
      tokens: legs.length > 1 ? legs : null, // a single leg adds nothing over the header
    });
  }

  const unpriced: string[] = [];
  for (const entry of trc20) {
    const [contract, rawAmount] = Object.entries(entry)[0];
    const coin = coins[`tron:${contract}`];
    if (!coin) {
      // No free price source — instead of silently swallowing it, we surface it
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
  // Legacy TRC10 — only a numeric ID, no contract address: there's no free
  // price source, so we log the fact that it was skipped
  for (const asset of trc10) unpriced.push(`TRC10 #${asset.key}`);

  const totalUsd = positions.reduce((sum, p) => sum + p.valueUsd, 0);

  // Energy, bandwidth and delegation locks — a different API and a different
  // clock from the balances above. A failure here must not cost us the balance
  // we already have: the result goes out without `tron`, which leaves whatever
  // is stored in place rather than replacing it with a gap.
  let tron: ScanResult['tron'];
  if (resourcesDue(resourcesAt)) {
    try {
      tron = await getTronResources(address);
    } catch {
      // next scan tries again; until then the stored snapshot stands
    }
  }

  return {
    chain: 'TRON',
    address,
    totalUsd,
    positions,
    unpriced: unpriced.length ? unpriced : undefined,
    tron,
  };
}
