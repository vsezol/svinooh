import { kaminoDeposits } from './kamino';
import { assemble } from './solana';
import {
  DepositNotSupportedError,
  type BuiltDeposit,
  type DepositRequest,
  type SolanaDeposits,
} from './types';

export { DepositNotSupportedError };
export type { BuiltDeposit, DepositRequest };

const SOLANA: SolanaDeposits[] = [kaminoDeposits];

export function depositsInto(request: DepositRequest): SolanaDeposits | null {
  if (request.network !== 'sol') return null;
  return SOLANA.find((into) => into.protocol === request.protocol) ?? null;
}

export async function buildDeposit(
  request: DepositRequest,
  owner: string,
  rpcUrl: string,
): Promise<BuiltDeposit> {
  const into = depositsInto(request);
  if (!into) {
    throw new DepositNotSupportedError(
      `${request.protocol} on ${request.network} is not wired for deposits here yet`,
    );
  }
  if (!into.supports(request)) {
    throw new DepositNotSupportedError(
      `${request.protocol} ${request.poolKind} pools are not wired for deposits here yet`,
    );
  }
  return assemble(await into.instructions(request, owner, rpcUrl), owner, rpcUrl);
}
