import type { Decimal } from 'decimal.js';
import type { BuiltTransaction } from '../../application/deposits';
import type { Pool } from '../../domain/pool';
import type { Withdrawal } from '../../domain/withdrawal';
import { assemble } from '../solana';
import { kamino, NO_TABLE, SLOT_DURATION_MS, type Built } from './deposits';

export async function buildKaminoWithdrawal(
  withdrawal: Withdrawal,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const out = await leaving(withdrawal.pool, withdrawal.owner, withdrawal.shares, withdrawal.all, rpcUrl);
  const { pool } = withdrawal;
  return assemble(
    { owner: withdrawal.owner, token: pool.token.symbol, decimals: pool.token.decimals },
    out.instructions,
    rpcUrl,
    out.lookups,
  );
}

/**
 * The instructions that take shares out of a vault and turn them back into
 * its token: off the farm, out of the vault.
 *
 * Taking all of it also closes what the deposit opened — the farm's record of
 * this owner and the account the shares sat in — so the SOL locked as their
 * rent comes back with the money, instead of staying behind in two empty
 * accounts nobody will think to close. The SDK does both when it is told the
 * whole position is going; closing either again here fails the transaction.
 */
export async function leaving(
  pool: Pool,
  owner: string,
  shares: Decimal,
  all: boolean,
  rpcUrl: string,
): Promise<Built> {
  const { klend, rpc, signer } = await kamino(owner, rpcUrl);
  const vault = new klend.KaminoVault(
    rpc,
    pool.deposit.address as never,
    SLOT_DURATION_MS,
    undefined,
    pool.deposit.programId as never,
  );
  const state = await vault.getState();
  const client = vault.client;
  const reserves = await client.loadVaultReserves(state);
  const farm = await client.loadVaultFarmState(state);
  const now = await klend.getCurrentLedgerInstant(rpc);
  const ixs = await client.withdrawIxs(
    signer,
    vault,
    shares,
    now,
    reserves,
    farm,
    null,
    undefined,
    undefined,
    all,
  );
  const instructions: unknown[] = [
    ...ixs.unstakeFromFarmIfNeededIxs,
    ...ixs.withdrawIxs,
    ...ixs.postWithdrawIxs,
  ];
  const table = String(state.vaultLookupTable);
  return { instructions, lookups: table && table !== NO_TABLE ? [table] : [] };
}
