import { Decimal } from 'decimal.js';
import type { ReadPositions } from '../../application/moves';
import type { Pool } from '../../domain/pool';
import { idOf } from '../../domain/values';
import type { Position } from '../../domain/withdrawal';
import { SLOT_DURATION_MS, type Sdk, type SdkRpc } from './deposits';

/** getMultipleAccounts answers at most this many addresses a call. */
const BATCH = 100;

/**
 * What an owner holds in Kamino's vaults, read from the chain rather than from
 * anybody's index of it.
 *
 * A vault share lives in one of two places: in the wallet as a token, or
 * staked in the vault's farm, which is where a deposit puts it. The first is
 * one read of the wallet's token accounts. The second is one account per farm
 * at an address derived from the owner, so every farm in the catalog is asked
 * in a single batch rather than by searching the farms program for the owner.
 */
export const kaminoPositions =
  (rpcUrl: string): ReadPositions =>
  async (owner, pools) => {
    const vaults = pools.filter(
      (pool) =>
        pool.id.protocol === 'kamino' && pool.id.kind === 'vault' && pool.deposit.sharesMint,
    );
    if (!vaults.length) return [];
    const kit = await import('@solana/kit');
    const klend = await import('@kamino-finance/klend-sdk');
    const rpc = kit.createSolanaRpc(rpcUrl);
    const held = await loose(rpc, owner);
    const staked = await inFarms(rpc, owner, vaults);
    const holdings = vaults
      .map((pool) => ({
        pool,
        shares: (held.get(pool.deposit.sharesMint as string) ?? new Decimal(0)).plus(
          staked.get(idOf(pool.id)) ?? 0,
        ),
      }))
      .filter(({ shares }) => shares.greaterThan(0));
    return Promise.all(
      holdings.map(
        async ({ pool, shares }): Promise<Position> => ({
          pool,
          shares,
          amount: shares.mul(await tokensPerShare(klend, rpc as unknown as SdkRpc, pool)),
        }),
      ),
    );
  };

type Rpc = ReturnType<typeof import('@solana/kit').createSolanaRpc>;

async function loose(rpc: Rpc, owner: string): Promise<Map<string, Decimal>> {
  const kit = await import('@solana/kit');
  const token = await import('@solana-program/token');
  const { value } = await rpc
    .getTokenAccountsByOwner(
      kit.address(owner),
      { programId: token.TOKEN_PROGRAM_ADDRESS },
      { encoding: 'jsonParsed' },
    )
    .send();
  const byMint = new Map<string, Decimal>();
  for (const one of value) {
    const info = one.account.data.parsed.info;
    const amount = new Decimal(info.tokenAmount.uiAmountString ?? '0');
    byMint.set(info.mint, (byMint.get(info.mint) ?? new Decimal(0)).plus(amount));
  }
  return byMint;
}

async function inFarms(rpc: Rpc, owner: string, vaults: Pool[]): Promise<Map<string, Decimal>> {
  const kit = await import('@solana/kit');
  const farms = await import('@kamino-finance/farms-sdk');
  const farmed = vaults.filter((pool) => pool.deposit.farm);
  const addresses = await Promise.all(
    farmed.map((pool) =>
      farms.getUserStatePDA(
        farms.FARMS_PROGRAM_ADDRESS,
        kit.address(pool.deposit.farm as string),
        kit.address(owner),
      ),
    ),
  );
  const staked = new Map<string, Decimal>();
  for (let from = 0; from < addresses.length; from += BATCH) {
    const states = await farms.fetchAllMaybeUserState(rpc, addresses.slice(from, from + BATCH));
    states.forEach((state, at) => {
      if (!state.exists) return;
      const pool = farmed[from + at];
      const lamports = new Decimal(farms.scaleDownWads(state.data.activeStakeScaled).toString());
      if (lamports.lessThan(1)) return;
      const decimals = pool.deposit.sharesDecimals ?? pool.token.decimals ?? 0;
      staked.set(idOf(pool.id), new Decimal(farms.lamportsToCollDecimal(lamports, decimals).toString()));
    });
  }
  return staked;
}

async function tokensPerShare(klend: Sdk, rpc: SdkRpc, pool: Pool): Promise<Decimal> {
  const vault = new klend.KaminoVault(
    rpc,
    pool.deposit.address as never,
    SLOT_DURATION_MS,
    undefined,
    pool.deposit.programId as never,
  );
  const state = await vault.getState();
  const reserves = await vault.client.loadVaultReserves(state);
  const now = await klend.getCurrentLedgerInstant(rpc);
  return vault.client.getTokensPerShareSingleVault(vault, now, reserves, now);
}
