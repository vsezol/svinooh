import type { DepositStepDto } from '@svinooh/shared';
import { buildDeposit, followDeposit, sleep } from './index';
import type { DepositOutcome, DepositRequest, DepositStopped } from './types';
import type { DepositWallet } from './wallet';

export type DepositStage = 'building' | 'signing' | 'landing' | 'continuing';

export type DepositRun = { done: DepositOutcome } | { failed: string; at: DepositStopped };

interface Asked {
  request: DepositRequest;
  wallet: DepositWallet;
  onStage?: (stage: DepositStage) => void;
  onSent?: (signature: string) => void;
  onLanded?: () => void;
  wait?: (ms: number) => Promise<void>;
}

export async function runDeposit({
  request,
  wallet,
  onStage,
  onSent,
  onLanded,
  wait,
}: Asked): Promise<DepositRun> {
  let signer;
  try {
    signer = await wallet.connect();
  } catch (error) {
    return { failed: why(error, `${wallet.name} did not connect`), at: 'connect' };
  }
  let built;
  try {
    onStage?.('building');
    built = await buildDeposit(request, signer.address);
  } catch (error) {
    // The server refused to build it — it knows why, in words, and that is a
    // thing to say rather than a thing to retry.
    return { failed: why(error, 'the deposit could not be prepared'), at: 'build' };
  }
  let last;
  try {
    last = await signed(built.transaction);
  } catch (error) {
    return { failed: why(error, 'the deposit was not sent'), at: 'wallet' };
  }

  // One transaction could not hold it all: the money has left where it was,
  // and each step after is built only now, against a wallet that has what
  // the one before it left there. A step that cannot be built, signed or
  // landed leaves the money in the wallet, and that is said rather than
  // called a failure of the whole.
  let asked = request;
  for (let steps = 1; built.then && last.landed === 'landed'; steps++) {
    const after = built.then;
    const reached = last;
    const halfway = (reason: string): DepositRun => ({
      done: { ...reached, halfway: true, error: reason, holding: after.holding },
    });
    if (steps === MOST_STEPS) return halfway('it took more steps than one button should');
    asked = stepAfter(asked, after);
    try {
      onStage?.('continuing');
      built = await buildAfterLanding(asked, signer.address, wait ?? sleep);
    } catch (error) {
      return halfway(why(error, 'the next step could not be prepared'));
    }
    let landed;
    try {
      landed = await signed(built.transaction);
    } catch (error) {
      return halfway(why(error, 'the next step was not sent'));
    }
    if (landed.landed === 'failed') return halfway(landed.error ?? 'the network rejected the next step');
    last = landed;
  }
  return { done: last };

  async function signed(transaction: string): Promise<DepositOutcome & { ok: true }> {
    onStage?.('signing');
    const signature = await signer!.signAndSend(transaction);
    onSent?.(signature);
    onStage?.('landing');
    const seen = await followDeposit(signature, signer!.address, request.network, wait).catch(
      () => null,
    );
    if (seen?.status === 'landed' && seen.tracked) onLanded?.();
    return {
      ok: true,
      signature,
      landed: seen?.status,
      tracked: seen?.tracked,
      error: seen?.error ?? null,
    };
  }
}

/**
 * The most steps one button signs: out, swap and in for a move, or a
 * position emptied over two transactions, a swap and a new one opened.
 */
const MOST_STEPS = 5;

/**
 * A step built right after the one before it landed can be simulated against
 * a node that has not seen that landing yet, so it is asked for again before
 * it is given up on.
 */
const BUILD_TRIES = 3;
const BUILD_GAP_MS = 2500;

async function buildAfterLanding(
  request: DepositRequest,
  owner: string,
  wait: (ms: number) => Promise<void>,
) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await buildDeposit(request, owner);
    } catch (error) {
      if (attempt >= BUILD_TRIES) throw error;
      await wait(BUILD_GAP_MS);
    }
  }
}

/**
 * What to ask for after a step that landed: what it left in the wallet, and
 * where that goes next — into a pool, swapped on the way when it is not the
 * pool's own token, or swapped into the coin the whole thing ends as.
 */
export function stepAfter(request: DepositRequest, then: DepositStepDto): DepositRequest {
  if (then.action) {
    // Liquidity says what its next step is, and carries every figure it needs.
    return {
      ...request,
      action: then.action,
      poolId: then.poolId ?? request.poolId,
      amount: then.amount ?? '',
      fromPoolId: undefined,
      payWith: then.payWith ? { mint: then.payWith, symbol: then.holding } : undefined,
      receiveAs: undefined,
      position: then.position ?? request.position,
      amountX: then.amountX,
      amountY: then.amountY,
      belowPct: then.belowPct ?? request.belowPct,
      abovePct: then.abovePct ?? request.abovePct,
    };
  }
  return {
    ...request,
    action: then.poolId ? 'deposit' : 'swap',
    poolId: then.poolId ?? request.poolId,
    amount: then.amount ?? '',
    fromPoolId: undefined,
    payWith: then.payWith ? { mint: then.payWith, symbol: then.holding } : undefined,
    receiveAs: then.receiveAs
      ? { mint: then.receiveAs, symbol: request.receiveAs?.symbol ?? then.receiveAs }
      : undefined,
  };
}

function why(error: unknown, fallback: string): string {
  const said = error instanceof Error ? error.message : '';
  return said || fallback;
}
