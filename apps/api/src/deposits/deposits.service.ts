import { Injectable, Logger } from '@nestjs/common';
import { config } from '../config';
import { buildDeposit } from './index';
import { DepositNotSupportedError, type BuiltDeposit, type DepositRequest } from './types';

interface CatalogPool {
  id: string;
  network: string;
  protocol: string;
  kind: string;
  name: string;
  token: { symbol: string; mint: string; decimals?: number | null };
  deposit: {
    program_id: string;
    address: string;
    min_amount?: string | null;
    shares_mint?: string | null;
    shares_decimals?: number | null;
    token_program?: string | null;
    lending_market?: string | null;
  };
}

@Injectable()
export class DepositsService {
  private readonly log = new Logger(DepositsService.name);

  async build(poolId: string, amount: string, owner: string): Promise<BuiltDeposit> {
    const pool = await this.pool(poolId);
    const request: DepositRequest = {
      poolId: pool.id,
      pool: pool.name,
      protocol: pool.protocol,
      poolKind: pool.kind,
      network: pool.network,
      token: pool.token.symbol,
      amount,
      accounts: {
        programId: pool.deposit.program_id,
        address: pool.deposit.address,
        tokenMint: pool.token.mint,
        tokenDecimals: pool.token.decimals ?? null,
        sharesMint: pool.deposit.shares_mint ?? null,
        sharesDecimals: pool.deposit.shares_decimals ?? null,
        tokenProgram: pool.deposit.token_program ?? null,
        lendingMarket: pool.deposit.lending_market ?? null,
      },
    };
    const built = await buildDeposit(request, owner, config.solanaRpcUrl);
    this.log.log(`built ${amount} ${pool.token.symbol} into ${pool.id} for ${owner.slice(0, 6)}…`);
    return built;
  }

  private async pool(poolId: string): Promise<CatalogPool> {
    const answered = await fetch(
      `${config.earnApiUrl}/v1/lend/pools/${encodeURIComponent(poolId)}`,
    ).catch(() => null);
    if (!answered?.ok) {
      throw new DepositNotSupportedError(`the catalog does not have ${poolId} right now`);
    }
    return ((await answered.json()) as { data: CatalogPool }).data;
  }
}
