import { Logger } from '@nestjs/common';
import type { Pool } from '../../domain/pool';
import type { KaminoApi } from './api';
import { buildIndex, reserveToPool, vaultToPool } from './mapping';

export class KaminoSource {
  readonly name = 'kamino';
  private readonly log = new Logger('KaminoSource');

  constructor(
    private readonly api: KaminoApi,
    private readonly includeReserves = true,
  ) {}

  async fetch(): Promise<Pool[]> {
    const vaults = await this.api.vaults();
    const metrics = await this.api.vaultMetrics();
    const perMarket = await this.api.reservesByMarket(await this.api.markets());
    const index = buildIndex(vaults, perMarket);

    const pools: Pool[] = [];
    for (const vault of vaults) {
      const pool = vaultToPool(vault, metrics.get(vault.address ?? '') ?? {}, index);
      if (pool !== null) pools.push(pool);
    }

    if (this.includeReserves) {
      for (const entry of perMarket) {
        for (const reserve of entry.reserves) {
          const pool = reserveToPool(reserve, entry.market, entry.name, index);
          if (pool !== null) pools.push(pool);
        }
      }
    }

    this.log.log(
      `kamino: ${vaults.length} vaults, ${perMarket.length} markets, ${pools.length} pools`,
    );
    return pools;
  }
}
