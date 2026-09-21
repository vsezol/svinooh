import { buildDeposit, followDeposit } from './index';
import type { DepositOutcome, DepositRequest, DepositStopped } from './types';
import type { DepositWallet } from './wallet';

export type DepositStage = 'building' | 'signing' | 'landing';

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
  try {
    onStage?.('signing');
    const signature = await signer.signAndSend(built.transaction);
    onSent?.(signature);
    onStage?.('landing');
    const seen = await followDeposit(signature, signer.address, request.network, wait).catch(
      () => null,
    );
    return {
      done: {
        ok: true,
        signature,
        landed: seen?.status,
        tracked: seen?.tracked,
        error: seen?.error ?? null,
      },
    };
  } catch (error) {
    return { failed: why(error, 'the deposit was not sent'), at: 'wallet' };
  }
}

function why(error: unknown, fallback: string): string {
  const said = error instanceof Error ? error.message : '';
  return said || fallback;
}
