import type { BuildDeposit } from '../application/deposits';
import { buildKaminoDeposit } from './kamino/deposits';

export const buildersWith = (rpcUrl: string): Record<string, BuildDeposit> => ({
  'sol:kamino': (deposit) => buildKaminoDeposit(deposit, rpcUrl),
});
