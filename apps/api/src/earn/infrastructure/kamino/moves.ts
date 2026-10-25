import { Decimal } from 'decimal.js';
import type { BuiltTransaction } from '../../application/deposits';
import type { TakenOut } from '../../application/moves';
import { DepositNotSupported, DepositWouldFail } from '../../application/errors';
import { decimalsOf, mintOf, symbolOf, type Move, type Place } from '../../domain/move';
import type { Pool } from '../../domain/pool';
import { idOf } from '../../domain/values';
import type { Withdrawal } from '../../domain/withdrawal';
import { assemble, attempts, budgeted, fits, measure, type Payer } from '../solana';
import { intoLoaded, kamino, loadVault } from './deposits';
import { kaminoRoutes, ROOMY, SLIPPAGE_BPS, TIGHT } from './swap';
import { leaving } from './withdrawals';

const NATIVE = 'So11111111111111111111111111111111111111112';


/**
 * What leaving a pool takes: its instructions and their lookup tables, and —
 * out of a SOL vault — the unwrap, held back to go last. A SOL vault pays out
 * wrapped SOL and the SDK unwraps it at once, into lamports no swap and no
 * vault can take; left wrapped, it is exactly what the next step spends, and
 * the unwrap afterwards closes the account and returns its rent.
 */
interface Out {
  instructions: unknown[];
  lookups: string[];
  unwrap: unknown[];
}

const NOWHERE: Out = { instructions: [], lookups: [], unwrap: [] };

/**
 * Money from one place into another: out of a pool or the wallet, through a
 * swap when the tokens differ, into a pool or back into the wallet.
 *
 * What a pool pays out is measured by running the withdrawal rather than by
 * pricing the shares — a vault keeps a withdrawal fee, and a deposit of what
 * the shares are worth asks for money the withdrawal did not bring.
 */
export async function buildKaminoMove(move: Move, rpcUrl: string): Promise<BuiltTransaction> {
  const { from, owner } = move;
  const out = 'pool' in from ? await outOf(from.pool, owner, from.shares, from.all, rpcUrl) : NOWHERE;
  const arrived =
    'pool' in from
      ? await measure(
          {
            owner,
            token: from.pool.token.symbol,
            decimals: from.pool.token.decimals,
            mint: from.pool.token.mint,
            tokenProgram: from.pool.deposit.tokenProgram,
          },
          out.instructions,
          rpcUrl,
          out.lookups,
        )
      : BigInt(from.amount.mul(new Decimal(10).pow(from.coin.decimals)).toFixed(0, Decimal.ROUND_DOWN));
  if (arrived <= 0n) throw new DepositWouldFail(`there is no ${symbolOf(from)} to move`);
  return mintOf(from) === mintOf(move.to)
    ? sameToken(move, out, arrived, rpcUrl)
    : acrossTokens(move, out, arrived, rpcUrl);
}

export async function buildKaminoTakeOut(withdrawal: Withdrawal, rpcUrl: string): Promise<TakenOut> {
  const { pool, owner } = withdrawal;
  const out = await outOf(pool, owner, withdrawal.shares, withdrawal.all, rpcUrl);
  const payer = { owner, token: pool.token.symbol, decimals: pool.token.decimals };
  const arrived = await measure(
    { ...payer, mint: pool.token.mint, tokenProgram: pool.deposit.tokenProgram },
    out.instructions,
    rpcUrl,
    out.lookups,
  );
  if (arrived <= 0n) throw new DepositWouldFail(`there is no ${pool.token.symbol} to take out`);
  const built = await assemble(payer, await budgeted([...out.instructions, ...out.unwrap]), rpcUrl, {
    read: out.lookups,
  });
  return { built, arrived: inUnits(arrived, decimalsOf({ pool })) };
}

/**
 * Between two pools of one token: out and in together, and the deposit is
 * what the withdrawal brought. When a farm on each side leaves no room for
 * both, it is two: the withdrawal now, and the deposit once it has landed.
 */
async function sameToken(
  move: Move,
  out: Out,
  arrived: bigint,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const { owner } = move;
  const to = intoPool(move.to);
  const amount = inUnits(arrived, decimalsOf(move.to));
  const { klend, rpc, signer } = await kamino(owner, rpcUrl);
  const into = await intoLoaded(await loadVault(klend, rpc, to), signer, amount);
  const whole = await budgeted(
    once([...out.instructions, ...alreadyWrapped(into.instructions, to), ...out.unwrap]),
  );
  const tables = { read: [...new Set([...out.lookups, ...into.lookups])] };
  const payer = { owner, token: to.token.symbol, decimals: to.token.decimals };
  if (await fits(owner, whole, rpcUrl, tables)) return assemble(payer, whole, rpcUrl, tables);
  const first = await budgeted([...out.instructions, ...out.unwrap]);
  const built = await assemble(payer, first, rpcUrl, { read: out.lookups });
  return {
    ...built,
    then: { poolId: idOf(to.id), amount: amount.toFixed(), holding: to.token.symbol },
  };
}

/**
 * Across tokens, through a swap, in as few transactions as fit.
 *
 * Into a vault, one when it fits: out, swap, in — and the deposit is the
 * least the swap is bound to pay, so a price that moves by less than the
 * slippage leaves the difference in the wallet rather than failing. When no
 * route leaves room for the deposit — a vault with a farm opens accounts no
 * lookup table can hold — or the pool is a lending market's reserve, out and
 * swap go now and the deposit once they have landed. When not even a
 * withdrawal and a swap fit together, the withdrawal goes alone and the rest
 * is built from the wallet. Into the wallet, the swap is the last step.
 * However many there are, it is one button; each step after the first only
 * asks for another signature, and is built against a wallet that has landed
 * the one before it.
 */
async function acrossTokens(
  move: Move,
  out: Out,
  arrived: bigint,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const { from, to, owner } = move;
  const tokenIn = mintOf(from);
  const tokenOut = mintOf(to);
  // Native SOL is wrapped for the swap when it comes out of the wallet, and
  // unwrapped when it goes back into it. A vault pays out and takes wrapped
  // SOL, so between a pool and a swap it stays as it is.
  const wallet = ('coin' in from && tokenIn === NATIVE) || ('coin' in to && tokenOut === NATIVE);
  let offered = 0;
  const swapping = async (maxAccounts: number, wrapSol: boolean) => {
    const routes = await kaminoRoutes({
      tokenIn,
      tokenOut,
      amount: arrived,
      owner,
      slippageBps: SLIPPAGE_BPS,
      maxAccounts,
      wrapSol,
    });
    offered += routes.length;
    return routes;
  };
  const trying = attempts(owner, rpcUrl);
  // Whose shortfall a refusal most likely is: the coin being spent, or the
  // token a pool is being filled with.
  const blamed = 'coin' in from ? payerOf(from) : payerOf(to);

  if ('coin' in to) {
    for (const maxAccounts of [ROOMY, TIGHT]) {
      for (const route of await swapping(maxAccounts, wallet)) {
        const all = await budgeted(once([...out.instructions, ...route.instructions, ...out.unwrap]));
        const built = await trying.one(all, { read: out.lookups, known: route.tables }, blamed);
        if (built) return built;
      }
    }
  } else {
    const pool = to.pool;
    if (pool.id.kind === 'vault') {
      const { klend, rpc, signer } = await kamino(owner, rpcUrl);
      const target = await loadVault(klend, rpc, pool);
      const unwrapped = tokenOut === NATIVE ? [await unwrapping(owner)] : [];
      for (const route of await swapping(TIGHT, wallet)) {
        const into = await intoLoaded(target, signer, inUnits(route.guaranteed, decimalsOf(to)));
        const all = await budgeted(
          once([
            ...out.instructions,
            ...route.instructions,
            ...alreadyWrapped(into.instructions, pool),
            ...out.unwrap,
            ...unwrapped,
          ]),
        );
        const tables = { read: [...new Set([...out.lookups, ...into.lookups])], known: route.tables };
        const built = await trying.one(all, tables, blamed);
        if (built) return built;
      }
    }
    for (const route of await swapping(ROOMY, wallet || tokenOut === NATIVE)) {
      const all = await budgeted(once([...out.instructions, ...route.instructions, ...out.unwrap]));
      const built = await trying.one(all, { read: out.lookups, known: route.tables }, payerOf(from));
      if (built) {
        const amount = inUnits(route.guaranteed, decimalsOf(to));
        return {
          ...built,
          then: { poolId: idOf(pool.id), amount: amount.toFixed(), holding: symbolOf(to) },
        };
      }
    }
  }
  // Only when every route was too big: one the chain refused says why, and
  // taking the money out first would only leave it waiting for the same refusal.
  const refused = trying.refused();
  if ('pool' in from && offered && !refused) return outFirst(move, out, arrived, rpcUrl);
  throw refused ?? nothingFits(from, to, offered);
}

/**
 * The withdrawal alone, when not even it and a swap fit together — a vault
 * spread over many reserves takes most of a transaction to leave. What it
 * brings waits in the wallet, and the rest is built from there: the swap, and
 * the deposit when the money is going into a pool.
 */
async function outFirst(
  move: Move,
  out: Out,
  arrived: bigint,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const { from, to, owner } = move;
  const first = await budgeted([...out.instructions, ...out.unwrap]);
  const built = await assemble({ owner, ...payerOf(from) }, first, rpcUrl, { read: out.lookups });
  return {
    ...built,
    then: {
      ...('pool' in to ? { poolId: idOf(to.pool.id) } : { receiveAs: to.coin.mint }),
      amount: inUnits(arrived, decimalsOf(from)).toFixed(),
      payWith: mintOf(from),
      holding: symbolOf(from),
    },
  };
}

/** What a refusal names: the token, and the places it counts in so a figure of it can be given. */
const payerOf = (place: Place): Omit<Payer, 'owner'> => ({
  token: symbolOf(place),
  decimals: decimalsOf(place),
});

const nothingFits = (from: Place, to: Place, offered: number) =>
  new DepositNotSupported(
    offered
      ? `no swap from ${symbolOf(from)} to ${symbolOf(to)} fits in a transaction right now`
      : `nobody will swap ${symbolOf(from)} for ${symbolOf(to)} right now`,
  );

function intoPool(place: Place): Pool {
  if (!('pool' in place)) {
    throw new DepositNotSupported('a move of one token into the wallet is a withdrawal');
  }
  return place.pool;
}

async function outOf(
  pool: Pool,
  owner: string,
  shares: Decimal,
  all: boolean,
  rpcUrl: string,
): Promise<Out> {
  const out = await leaving(pool, owner, shares, all, rpcUrl);
  if (pool.token.mint !== NATIVE) return { ...out, unwrap: [] };
  const wrapped = await wrappedSolOf(owner);
  const closes = (one: unknown) => closesAccount(one, wrapped);
  return {
    instructions: out.instructions.filter((one) => !closes(one)),
    lookups: out.lookups,
    unwrap: out.instructions.filter(closes),
  };
}

const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TRANSFER = 2;
const CLOSE_ACCOUNT = 9;
const SYNC_NATIVE = 17;

type Composed = { programAddress?: unknown; data?: Uint8Array; accounts?: { address: unknown; role: unknown }[] };

/**
 * A deposit into a SOL vault wraps native SOL into the account it pays from.
 * After a swap, or a vault, that left wrapped SOL in that very account, the
 * wrap is a second payment out of lamports the wallet does not have.
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

/** Whether this instruction closes that token account. */
export function closesAccount(instruction: unknown, account: string): boolean {
  const { programAddress, data, accounts } = instruction as Composed;
  return (
    String(programAddress) === TOKEN &&
    data?.[0] === CLOSE_ACCOUNT &&
    String(accounts?.[0]?.address) === account
  );
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

async function wrappedSolOf(owner: string): Promise<string> {
  const kit = await import('@solana/kit');
  const token = await import('@solana-program/token');
  const [account] = await token.findAssociatedTokenPda({
    owner: kit.address(owner),
    mint: kit.address(NATIVE),
    tokenProgram: token.TOKEN_PROGRAM_ADDRESS,
  });
  return String(account);
}

/** Closing the owner's wrapped SOL account: what is left in it comes back as SOL, with its rent. */
async function unwrapping(owner: string): Promise<unknown> {
  const kit = await import('@solana/kit');
  const token = await import('@solana-program/token');
  return token.getCloseAccountInstruction({
    account: kit.address(await wrappedSolOf(owner)),
    destination: kit.address(owner),
    owner: kit.address(owner),
  });
}

const inUnits = (base: bigint, decimals: number): Decimal =>
  new Decimal(base.toString()).div(new Decimal(10).pow(decimals));
