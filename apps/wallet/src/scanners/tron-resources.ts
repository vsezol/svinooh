import type { TronDelegation, TronFlags, TronResources } from '@svinooh/shared';
import { sleep } from '@svinooh/common';
import { config } from '../config';

/**
 * What a Tron wallet can spend, and what it has lent out.
 *
 * Ported from the defi-ltv monolith (`tron.js`), where this ran in production
 * for months. The shape of the calls and the pacing between them are the part
 * that was learned the hard way and is kept verbatim; only the types and the
 * transport are new.
 *
 * This is separate from `scanTron`, which reads balances off one cheap indexed
 * endpoint. Resources come from the node RPC, cost four or more calls, and have
 * to be spaced out — so they are refreshed on their own slower clock and the
 * two are not mixed up with each other.
 */

/** The official gateway, then Tatum's — the same API behind both */
const TRON_APIS = ['https://api.trongrid.io', 'https://tron-mainnet.gateway.tatum.io'];
const RETRY_ROUNDS = 3;
/**
 * Between calls, per wallet. TronGrid's free tier is per-second and unforgiving,
 * and the alternative to waiting is a 429 that costs the whole read. Deliberate,
 * not incidental — see the acceptance criteria this was ported against.
 */
const CALL_GAP_MS = 300;
const TIMEOUT_MS = 20_000;

/** Enough bandwidth to actually send the transaction the alert is telling you about */
const BANDWIDTH_FOR_TX = 500;

async function tronPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
  let lastError: unknown;
  for (let round = 0; round < RETRY_ROUNDS; round++) {
    if (round > 0) await sleep(2000 * round);
    for (const base of TRON_APIS) {
      try {
        const response = await fetch(`${base}${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            // Keyless works, but a key is what keeps us off the shared free-tier
            // bucket once there is more than a handful of Tron wallets
            ...(config.tronApiKey ? { 'TRON-PRO-API-KEY': config.tronApiKey } : {}),
          },
          // visible:true — talk in base58 addresses rather than hex, which is
          // what we store and what everything else here means by an address
          body: JSON.stringify({ ...body, visible: true }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`Tron API ${response.status}`);
        return (await response.json()) as T;
      } catch (error) {
        lastError = error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface AccountResponse {
  account_resource?: {
    delegated_frozenV2_balance_for_energy?: number;
    delegated_frozenV2_balance_for_bandwidth?: number;
  };
  delegated_frozenV2_balance_for_energy?: number;
  delegated_frozenV2_balance_for_bandwidth?: number;
}

interface ResourceResponse {
  EnergyLimit?: number;
  EnergyUsed?: number;
  freeNetLimit?: number;
  freeNetUsed?: number;
  NetLimit?: number;
  NetUsed?: number;
  TotalEnergyLimit?: number;
  TotalEnergyWeight?: number;
  TotalNetLimit?: number;
  TotalNetWeight?: number;
}

interface DelegatedResource {
  frozen_balance_for_energy?: number;
  frozen_balance_for_bandwidth?: number;
  expire_time_for_energy?: number;
  expire_time_for_bandwidth?: number;
}

/**
 * Read a wallet's resources.
 *
 * The calls are SEQUENTIAL with pauses, and that is the point — running them
 * together is what earns a 429 and loses the whole read. One wallet with three
 * delegatees is six calls and about two seconds, which is why this is not on
 * the balance path.
 */
export async function getTronResources(address: string): Promise<TronResources> {
  const account = await tronPost<AccountResponse>('/wallet/getaccount', { address });
  await sleep(CALL_GAP_MS);
  const resource = await tronPost<ResourceResponse>('/wallet/getaccountresource', { address });
  await sleep(CALL_GAP_MS);
  const index = await tronPost<{ toAccounts?: string[] }>(
    '/wallet/getdelegatedresourceaccountindexv2',
    { value: address },
  );

  const energyTotal = resource.EnergyLimit ?? 0;
  const energyFree = Math.max(0, energyTotal - (resource.EnergyUsed ?? 0));

  // Bandwidth comes in two buckets — the free daily allowance every account
  // gets, and what staking earned — and a transaction spends either, so what is
  // left is the two added together
  const freeNetLimit = resource.freeNetLimit ?? 0;
  const netLimit = resource.NetLimit ?? 0;
  const bandwidthTotal = freeNetLimit + netLimit;
  const bandwidthFree =
    Math.max(0, freeNetLimit - (resource.freeNetUsed ?? 0)) +
    Math.max(0, netLimit - (resource.NetUsed ?? 0));

  // What one staked TRX currently buys, network-wide. It moves with total stake,
  // so the resource figures below are only true for the moment they were read.
  const energyPerTrx = resource.TotalEnergyWeight
    ? (resource.TotalEnergyLimit ?? 0) / resource.TotalEnergyWeight
    : 0;
  const bandwidthPerTrx = resource.TotalNetWeight
    ? (resource.TotalNetLimit ?? 0) / resource.TotalNetWeight
    : 0;

  // The node reports these under account_resource for one resource and at the
  // top level for the other, and has been known to swap which — take whichever
  // answered
  const accountResource = account.account_resource ?? {};
  const delegatedEnergySun =
    accountResource.delegated_frozenV2_balance_for_energy ??
    account.delegated_frozenV2_balance_for_energy ??
    0;
  const delegatedBandwidthSun =
    account.delegated_frozenV2_balance_for_bandwidth ??
    accountResource.delegated_frozenV2_balance_for_bandwidth ??
    0;

  const delegatedEnergyTrx = delegatedEnergySun / 1e6;
  const delegatedBandwidthTrx = delegatedBandwidthSun / 1e6;

  // Who it went to says nothing we need; WHEN each piece unlocks is everything
  const delegations: TronDelegation[] = [];
  for (const to of index.toAccounts ?? []) {
    await sleep(CALL_GAP_MS);
    const detail = await tronPost<{ delegatedResource?: DelegatedResource[] }>(
      '/wallet/getdelegatedresourcev2',
      { fromAddress: address, toAddress: to },
    );
    for (const d of detail.delegatedResource ?? []) {
      if (d.frozen_balance_for_energy) {
        delegations.push({ type: 'energy', expireAt: d.expire_time_for_energy ?? 0 });
      }
      if (d.frozen_balance_for_bandwidth) {
        delegations.push({ type: 'bandwidth', expireAt: d.expire_time_for_bandwidth ?? 0 });
      }
    }
  }

  return {
    energyFree,
    energyTotal,
    bandwidthFree,
    bandwidthTotal,
    delegatedEnergy: Math.round(delegatedEnergyTrx * energyPerTrx),
    delegatedEnergyTrx,
    delegatedBandwidth: Math.round(delegatedBandwidthTrx * bandwidthPerTrx),
    delegatedBandwidthTrx,
    delegations,
    // A wallet can have delegated balances the index has not caught up with, or
    // an index entry whose balances read zero — either answers yes
    hasDelegation: delegatedEnergySun > 0 || delegatedBandwidthSun > 0 || delegations.length > 0,
  };
}

/**
 * When the wallet's outgoing delegations can be taken back.
 *
 * `expireAt` of 0 is a delegation made WITHOUT a lock, not one that expired in
 * 1970 — both mean it can be reclaimed now, which is why they are the same
 * branch. `nextReclaimAt` is the soonest of whatever is still locked, and null
 * when nothing is.
 */
export function tronReclaimInfo(
  resources: TronResources,
  now: number,
): { reclaimableNow: boolean; nextReclaimAt: number | null } {
  let reclaimableNow = false;
  let nextReclaimAt: number | null = null;
  for (const delegation of resources.delegations) {
    if (!delegation.expireAt || delegation.expireAt <= now) {
      reclaimableNow = true;
    } else if (nextReclaimAt === null || delegation.expireAt < nextReclaimAt) {
      nextReclaimAt = delegation.expireAt;
    }
  }
  return { reclaimableNow, nextReclaimAt };
}

/**
 * What the owner could do right now.
 *
 * Both carry the bandwidth the transaction itself needs: telling somebody they
 * can reclaim when they cannot afford to send the reclaim is telling them
 * nothing. `delegate` also requires that nothing is out already — this is about
 * resources sitting idle, and a wallet that has already lent them out is not
 * idle even if some energy has regenerated since.
 */
export function computeTronFlags(resources: TronResources, now: number): TronFlags {
  const { reclaimableNow } = tronReclaimInfo(resources, now);
  return {
    reclaim: reclaimableNow && resources.bandwidthFree > BANDWIDTH_FOR_TX,
    delegate:
      resources.energyFree > 0 &&
      resources.bandwidthFree > BANDWIDTH_FOR_TX &&
      !resources.hasDelegation,
  };
}
