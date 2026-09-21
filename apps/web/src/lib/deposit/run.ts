import { buildDeposit, followDeposit } from './index';
import type { DepositOutcome, DepositRequest, DepositStopped } from './types';
import type { DepositWallet } from './wallet';

export type DepositStage = 'building' | 'signing' | 'landing' | 'continuing';

export type DepositRun = { done: DepositOutcome } | { failed: string; at: DepositStopped };

interface Asked {
  request: DepositRequest;
  wallet: DepositWallet;
  onStage?: (stage: DepositStage) => void;
  onSent?: (signature: string) => void;
  wait?: (ms: number) => Promise<void>;
}

export async function runDeposit({
  request,
  wallet,
  onStage,
  onSent,
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
  let first;
  try {
    first = await signed(built.transaction);
  } catch (error) {
    return { failed: why(error, 'the deposit was not sent'), at: 'wallet' };
  }
  if (!built.then || first.landed !== 'landed') return { done: first };

  // One transaction could not hold the whole move: the money is out and
  // swapped, and the second half is the deposit of what the swap was bound
  // to pay. It is built only now, against a wallet that has it.
  const after = built.then;
  const halfway = (reason: string): DepositRun => ({
    done: { ...first, halfway: true, error: reason },
  });
  let second;
  try {
    onStage?.('continuing');
    second = await buildDeposit(
      { ...request, action: 'deposit', poolId: after.poolId, amount: after.amount },
      signer.address,
    );
  } catch (error) {
    return halfway(why(error, 'the deposit could not be prepared'));
  }
  try {
    return { done: await signed(second.transaction) };
  } catch (error) {
    return halfway(why(error, 'the deposit was not sent'));
  }

  async function signed(transaction: string): Promise<DepositOutcome & { ok: true }> {
    onStage?.('signing');
    const signature = await signer!.signAndSend(transaction);
    onSent?.(signature);
    onStage?.('landing');
    const seen = await followDeposit(signature, signer!.address, request.network, wait).catch(
      () => null,
    );
    return {
      ok: true,
      signature,
      landed: seen?.status,
      tracked: seen?.tracked,
      error: seen?.error ?? null,
    };
  }
}

function why(error: unknown, fallback: string): string {
  const said = error instanceof Error ? error.message : '';
  return said || fallback;
}
