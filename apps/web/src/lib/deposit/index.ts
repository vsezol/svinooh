import { buildKaminoDeposit } from './kamino';
import {
  DepositNotSupportedError,
  type BuildDeposit,
  type BuiltDeposit,
  type DepositRequest,
} from './types';

export { DepositNotSupportedError };
export type { BuiltDeposit, DepositRequest };

const BUILDERS: Record<string, BuildDeposit> = {
  'sol:kamino': buildKaminoDeposit,
};

export function builderFor(request: DepositRequest): BuildDeposit | null {
  return BUILDERS[`${request.network}:${request.protocol}`] ?? null;
}

export async function buildDeposit(
  request: DepositRequest,
  owner: string,
  rpcUrl: string,
): Promise<BuiltDeposit> {
  const build = builderFor(request);
  if (!build) {
    throw new DepositNotSupportedError(
      `${request.protocol} on ${request.network} is not wired for deposits here yet`,
    );
  }
  return build(request, owner, rpcUrl);
}
