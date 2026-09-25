import { Decimal } from 'decimal.js';
import type { Coin } from '../domain/move';
import type { Pool } from '../domain/pool';
import type { ReadHoldings } from './deposits';
import { CoinNotFound, DepositNotSupported } from './errors';
import type { LendQueries } from './queries';

/**
 * A coin by its mint or its ticker, looked for among what these owners hold
 * and in a directory of coins that trade; null when neither has it.
 */
export type FindCoin = (query: string, owners: readonly string[]) => Promise<Coin | null>;

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';

export interface Holding {
  coin: Coin;
  amount: Decimal | null;
}

export class LendCoins {
  constructor(
    private readonly queries: LendQueries,
    private readonly finders: Record<string, FindCoin> = {},
    private readonly holdings: Record<string, ReadHoldings> = {},
  ) {}

  async held(network: string, query: string, owner: string): Promise<Holding> {
    const read = this.holdings[network];
    if (!read) throw new DepositNotSupported(`${network} wallets are not read here yet`);
    const coin = await this.find(network, query, [owner]);
    return { coin, amount: await read(owner, coin) };
  }

  /**
   * The coin somebody means by a ticker or a mint.
   *
   * The catalog's own tokens come first: they are what its pools take, and a
   * wallet can hold a stranger's token under the same ticker. After them,
   * what the wallets hold, then the directory — where only a verified coin
   * answers to a ticker, since anybody can mint a token and call it USDC.
   */
  async find(network: string, query: string, owners: readonly string[] = []): Promise<Coin> {
    const asked = query.trim();
    const listed = this.listed(network, asked);
    if (listed) return listed;
    const find = this.finders[network];
    if (!find) throw new DepositNotSupported(`${network} coins are not looked up here yet`);
    const found = await find(asked, owners);
    if (!found) throw new CoinNotFound(`no coin called ${asked} trades on ${network}`);
    return found;
  }

  private listed(network: string, asked: string): Coin | null {
    const ticker = asked.toLowerCase();
    const pools = this.queries
      .onNetwork(network)
      .pools.filter(
        (pool) =>
          pool.token.decimals !== null &&
          (pool.token.mint === asked || pool.token.symbol.toLowerCase() === ticker),
      );
    const pool = deepest(pools);
    if (!pool) return null;
    return {
      symbol: pool.token.symbol,
      mint: pool.token.mint,
      decimals: pool.token.decimals ?? 0,
      program: pool.deposit.tokenProgram ?? TOKEN_PROGRAM,
    };
  }
}

/** Of pools that name a ticker, one of the mint the most money is in. */
function deepest(pools: Pool[]): Pool | null {
  const byMint = new Map<string, { pool: Pool; tvl: Decimal }>();
  for (const pool of pools) {
    const seen = byMint.get(pool.token.mint);
    byMint.set(pool.token.mint, {
      pool: seen?.pool ?? pool,
      tvl: (seen?.tvl ?? new Decimal(0)).plus(pool.tvlUsd),
    });
  }
  const [best] = [...byMint.values()].sort((a, b) => b.tvl.comparedTo(a.tvl));
  return best?.pool ?? null;
}
