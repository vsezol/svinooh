import type { DepositBuiltDto } from '@svinooh/shared';
import { api } from '../api';
import type { DepositOutcome, DepositRequest } from './types';

export type { DepositOutcome, DepositRequest };

export async function buildDeposit(
  request: DepositRequest,
  owner: string,
): Promise<DepositBuiltDto> {
  return api<DepositBuiltDto>('/deposits/build', {
    method: 'POST',
    body: JSON.stringify({ poolId: request.poolId, amount: request.amount, owner }),
  });
}
