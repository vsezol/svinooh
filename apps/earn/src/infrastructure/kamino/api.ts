import { gatherSuccessful, type JsonTransport } from '../http';

export interface AllocationPayload {
  reserve?: string;
  targetAllocationWeight?: number;
}

export interface VaultStatePayload {
  name?: string;
  tokenMint?: string;
  tokenMintDecimals?: number;
  tokenProgram?: string;
  sharesMint?: string;
  sharesMintDecimals?: number;
  performanceFeeBps?: number;
  managementFeeBps?: number;
  minDepositAmount?: string;
  vaultAllocationStrategy?: AllocationPayload[];
}

export interface VaultPayload {
  address?: string;
  programId?: string;
  state?: VaultStatePayload;
}

export interface VaultMetricsPayload {
  kvault?: string;
  apy?: string;
  apyFarmRewards?: string;
  apyIncentives?: string;
  apyReservesIncentives?: string;
  apy24h?: string;
  apy7d?: string;
  apy30d?: string;
  apy90d?: string;
  apy365d?: string;
  tokensAvailable?: string;
  tokensAvailableUsd?: string;
  tokensInvested?: string;
  tokensInvestedUsd?: string;
  numberOfHolders?: number;
}

export interface MarketPayload {
  name?: string;
  lendingMarket?: string;
}

export interface ReserveMetricsPayload {
  reserve?: string;
  liquidityToken?: string;
  liquidityTokenMint?: string;
  supplyApy?: string;
  borrowApy?: string;
  totalSupply?: string;
  totalBorrow?: string;
  totalSupplyUsd?: string;
}

export interface MarketReserves {
  market: string;
  name: string;
  reserves: ReserveMetricsPayload[];
}

export const MAX_METRIC_PAGES = 20;

export class KaminoApi {
  constructor(private readonly api: JsonTransport) {}

  async vaults(): Promise<VaultPayload[]> {
    return (await this.api.get('/kvaults/vaults')) as VaultPayload[];
  }

  async vaultMetrics(): Promise<Map<string, VaultMetricsPayload>> {
    const byVault = new Map<string, VaultMetricsPayload>();
    let token: string | null = null;
    for (let page = 0; page < MAX_METRIC_PAGES; page++) {
      const answered = (await this.api.get('/kvaults/vaults/metrics', {
        paginationToken: token,
      })) as { result?: VaultMetricsPayload[]; paginationToken?: string | null };
      for (const entry of answered.result ?? []) {
        if (entry.kvault) byVault.set(entry.kvault, entry);
      }
      token = answered.paginationToken ?? null;
      if (!token) break;
    }
    return byVault;
  }

  async markets(): Promise<MarketPayload[]> {
    return (await this.api.get('/v2/kamino-market')) as MarketPayload[];
  }

  async reservesByMarket(markets: MarketPayload[]): Promise<MarketReserves[]> {
    const one = async (market: MarketPayload): Promise<MarketReserves> => {
      const address = market.lendingMarket as string;
      const reserves = (await this.api.get(
        `/kamino-market/${address}/reserves/metrics`,
      )) as ReserveMetricsPayload[] | null;
      return {
        market: address,
        name: market.name || `Market ${address.slice(0, 8)}`,
        reserves: reserves ?? [],
      };
    };
    return gatherSuccessful(
      markets.filter((market) => market.lendingMarket),
      one,
      'kamino reserves',
    );
  }
}
