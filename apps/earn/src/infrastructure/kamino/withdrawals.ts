import { Decimal } from 'decimal.js';
import type { BuiltTransaction } from '../../application/deposits';
import { DepositWouldFail } from '../../application/errors';
import type { Pool } from '../../domain/pool';
import type { Move, Withdrawal } from '../../domain/withdrawal';
import { assemble, measure } from '../solana';
import {
  intoVault,
  NO_TABLE,
  SLOT_DURATION_MS,
  type Built,
  type Sdk,
  type SdkRpc,
  type Signer,
} from './deposits';

export async function buildKaminoWithdrawal(
  withdrawal: Withdrawal,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const out = await leaving(withdrawal.pool, withdrawal.owner, withdrawal.shares, withdrawal.all, rpcUrl);
  return assemble(
    { owner: withdrawal.owner, token: withdrawal.pool.token.symbol },
    out.instructions,
    rpcUrl,
    out.lookups,
  );
}

/**
 * Out of one vault and into another, in one transaction: either all of it
 * happens or none of it does, and there is one thing to sign.
 *
 * What the second vault is given is what the first one pays out, measured by
 * running the withdrawal rather than by pricing the shares — the vault keeps a
 * withdrawal fee, and a deposit of what the shares are worth asks for money
 * the withdrawal did not bring.
 */
export async function buildKaminoMove(move: Move, rpcUrl: string): Promise<BuiltTransaction> {
  const { from, to, owner } = move;
  const out = await leaving(from, owner, move.shares, move.all, rpcUrl);
  const arrived = await measure(
    { owner, token: from.token.symbol, mint: from.token.mint, tokenProgram: from.deposit.tokenProgram },
    out.instructions,
    rpcUrl,
    out.lookups,
  );
  if (arrived <= 0n) throw new DepositWouldFail(`taking this out of ${from.name} brings nothing to move`);
  const amount = new Decimal(arrived.toString()).div(new Decimal(10).pow(from.token.decimals ?? 0));
  const { klend, rpc, signer } = await kamino(owner, rpcUrl);
  const into = await intoVault(klend, rpc, signer, { pool: to, amount, owner });
  return assemble(
    { owner, token: to.token.symbol },
    [...out.instructions, ...into.instructions],
    rpcUrl,
    [...new Set([...out.lookups, ...into.lookups])],
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
async function leaving(
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

async function kamino(owner: string, rpcUrl: string) {
  const kit = await import('@solana/kit');
  const klend: Sdk = await import('@kamino-finance/klend-sdk');
  const rpc = kit.createSolanaRpc(rpcUrl) as unknown as SdkRpc;
  const signer: Signer = kit.createNoopSigner(kit.address(owner));
  return { kit, klend, rpc, signer };
}
