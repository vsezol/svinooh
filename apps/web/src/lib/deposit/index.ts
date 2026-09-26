import type { DepositBuiltDto, DepositLandingDto } from '@svinooh/shared';
import { api } from '../api';
import type { DepositCoin, DepositOutcome, DepositRequest } from './types';

export type { DepositCoin, DepositOutcome, DepositRequest };

const GAP_MS = 2000;
const TRIES = 20;

export async function buildDeposit(
  request: DepositRequest,
  owner: string,
): Promise<DepositBuiltDto> {
  return api<DepositBuiltDto>('/deposits/build', {
    method: 'POST',
    body: JSON.stringify({
      poolId: request.poolId,
      amount: request.amount || undefined,
      owner,
      action: request.action ?? 'deposit',
      fromPoolId: request.fromPoolId,
      payWith: request.payWith?.mint,
      receiveAs: request.receiveAs?.mint,
      position: request.position,
      amountX: request.amountX,
      amountY: request.amountY,
      belowPct: request.belowPct,
      abovePct: request.abovePct,
    }),
  });
}

export async function followDeposit(
  signature: string,
  owner: string,
  network: string,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<DepositLandingDto> {
  let seen = await askTheChain(signature, owner, network);
  for (let tick = 1; tick < TRIES && seen.status === 'pending'; tick++) {
    await wait(GAP_MS);
    seen = await askTheChain(signature, owner, network);
  }
  return seen;
}

const askTheChain = (signature: string, owner: string, network: string) =>
  api<DepositLandingDto>('/deposits/landed', {
    method: 'POST',
    body: JSON.stringify({ signature, owner, network }),
  });

export const sleep = (ms: number) => new Promise<void>((wake) => setTimeout(wake, ms));
