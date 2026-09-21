import { Decimal } from 'decimal.js';
import type { BuiltTransaction } from '../../application/deposits';
import { DepositNotSupported, DepositWouldFail } from '../../application/errors';
import type { Pool } from '../../domain/pool';
import { idOf } from '../../domain/values';
import type { Move, Withdrawal } from '../../domain/withdrawal';
import { assemble, fits, measure } from '../solana';
import { kaminoRoutes } from './swap';
import {
  intoLoaded,
  intoVault,
  loadVault,
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
  if (from.token.mint !== to.token.mint && from.token.mint === NATIVE) {
    throw new DepositNotSupported(
      `moving out of ${from.name} into another token is not wired here yet — it holds SOL`,
    );
  }
  const out = await leaving(from, owner, move.shares, move.all, rpcUrl);
  const arrived = await measure(
    { owner, token: from.token.symbol, mint: from.token.mint, tokenProgram: from.deposit.tokenProgram },
    out.instructions,
    rpcUrl,
    out.lookups,
  );
  if (arrived <= 0n) throw new DepositWouldFail(`taking this out of ${from.name} brings nothing to move`);
  if (from.token.mint !== to.token.mint) return acrossTokens(move, out, arrived, rpcUrl);
  const amount = inUnits(arrived, from);
  const { klend, rpc, signer } = await kamino(owner, rpcUrl);
  const into = await intoVault(klend, rpc, signer, { pool: to, amount, owner });
  return assemble(
    { owner, token: to.token.symbol },
    [...out.instructions, ...into.instructions],
    rpcUrl,
    [...new Set([...out.lookups, ...into.lookups])],
  );
}

const NATIVE = 'So11111111111111111111111111111111111111112';

/** Wide enough for a price that moves between building and signing, narrow enough to leave little behind. */
const SLIPPAGE_BPS = 30;

/** The smallest routes first when everything has to fit in one transaction. */
const TIGHT = 8;

/** A route on its own can afford a better price for more accounts. */
const ROOMY = 20;

/**
 * Compute for a move, and what to pay per unit of it.
 *
 * A wallet adds its own priority fee to a transaction that has none, and a
 * move is built close to the packet limit: two more instructions and the
 * compute budget program's address do not fit into the last few bytes, and a
 * wallet that cannot add them may refuse to send it at all. So a move carries
 * its own, and whether it fits is decided with them in it. A hundred thousand
 * micro-lamports a unit on a million units is a ten-thousandth of a SOL.
 */
const MOVE_UNITS = 1_000_000;
const STEP_UNITS = 600_000;
const MICRO_LAMPORTS = 100_000n;

async function budgeted(units: number, instructions: unknown[]): Promise<unknown[]> {
  const budget = await import('@solana-program/compute-budget');
  return [
    budget.getSetComputeUnitLimitInstruction({ units }),
    budget.getSetComputeUnitPriceInstruction({ microLamports: MICRO_LAMPORTS }),
    ...instructions.filter((one) => String((one as Composed).programAddress) !== COMPUTE_BUDGET),
  ];
}

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';

/**
 * Out of one pool, through a swap, into a pool of another token.
 *
 * In one transaction when it fits: out, swap, in, and the deposit is the
 * least the swap is bound to pay — a price that moves by less than the
 * slippage leaves the difference in the wallet rather than failing. When no
 * route leaves room for the deposit — a vault with a farm opens accounts no
 * lookup table can hold — it is two: out and swap now, and the deposit of what
 * the swap is bound to pay once that has landed. Either way it is the same
 * button; the second only asks for a second signature.
 */
async function acrossTokens(
  move: Move,
  out: Built,
  arrived: bigint,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const { from, to, owner } = move;
  const swapping = (maxAccounts: number, wrapSol: boolean) =>
    kaminoRoutes({
      tokenIn: from.token.mint,
      tokenOut: to.token.mint,
      amount: arrived,
      owner,
      slippageBps: SLIPPAGE_BPS,
      maxAccounts,
      wrapSol,
    });
  const payer = { owner, token: to.token.symbol };
  const { klend, rpc, signer } = await kamino(owner, rpcUrl);

  // A route that fits can still be one the chain refuses — a router's account
  // can be stale between its quote and our simulation — so a refusal moves on
  // to the next route rather than ending the move.
  let refused: Error | null = null;
  const attempt = async (
    all: unknown[],
    tables: { read: string[]; known: Record<string, string[]> },
    who = payer,
  ): Promise<BuiltTransaction | null> => {
    if (!(await fits(owner, all, rpcUrl, tables))) return null;
    try {
      return await assemble(who, all, rpcUrl, tables);
    } catch (error) {
      if (!(error instanceof DepositWouldFail)) throw error;
      refused = error;
      return null;
    }
  };

  const target = await loadVault(klend, rpc, to);
  const tight = await swapping(TIGHT, false);
  for (const route of tight) {
    const into = await intoLoaded(target, signer, inUnits(route.guaranteed, to));
    const all = await budgeted(
      MOVE_UNITS,
      once([...out.instructions, ...route.instructions, ...alreadyWrapped(into.instructions, to)]),
    );
    const tables = { read: [...new Set([...out.lookups, ...into.lookups])], known: route.tables };
    const built = await attempt(all, tables);
    if (built) return built;
  }

  const roomy = await swapping(ROOMY, to.token.mint === NATIVE);
  for (const route of roomy) {
    const all = await budgeted(STEP_UNITS, once([...out.instructions, ...route.instructions]));
    const built = await attempt(all, { read: out.lookups, known: route.tables }, {
      owner,
      token: from.token.symbol,
    });
    if (built) {
      return { ...built, then: { poolId: idOf(to.id), amount: inUnits(route.guaranteed, to).toString() } };
    }
  }

  if (refused) throw refused;
  throw new DepositNotSupported(
    tight.length || roomy.length
      ? `no swap from ${from.token.symbol} to ${to.token.symbol} fits in a transaction right now`
      : `nobody will swap ${from.token.symbol} for ${to.token.symbol} right now`,
  );
}

const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TRANSFER = 2;
const SYNC_NATIVE = 17;

type Composed = { programAddress?: unknown; data?: Uint8Array; accounts?: { address: unknown; role: unknown }[] };

/**
 * A deposit into a SOL vault wraps native SOL into the account it pays from.
 * After a swap that delivered wrapped SOL into that very account, the wrap is
 * a second payment out of lamports the wallet does not have.
 */
export function alreadyWrapped(instructions: unknown[], to: Pool): unknown[] {
  if (to.token.mint !== NATIVE) return instructions;
  return instructions.filter((one) => {
    const { programAddress, data } = one as Composed;
    const program = String(programAddress);
    if (program === SYSTEM && data?.[0] === TRANSFER) return false;
    if (program === TOKEN && data?.[0] === SYNC_NATIVE) return false;
    return true;
  });
}

/** The same instruction twice — the same account created by both halves — is once. */
export function once(instructions: unknown[]): unknown[] {
  const seen = new Set<string>();
  return instructions.filter((one) => {
    const { programAddress, data, accounts } = one as Composed;
    const key = [
      String(programAddress),
      (accounts ?? []).map((account) => `${String(account.address)}:${String(account.role)}`).join(','),
      Buffer.from(data ?? []).toString('hex'),
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const inUnits = (base: bigint, pool: Pool): Decimal =>
  new Decimal(base.toString()).div(new Decimal(10).pow(pool.token.decimals ?? 0));

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
