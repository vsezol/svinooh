import type { BuildDeposit, LookUpLanding } from '../application/deposits';
import { buildKaminoDeposit } from './kamino/deposits';
import { landingsVia } from './solana';

export const buildersWith = (rpcUrl: string): Record<string, BuildDeposit> => ({
  'sol:kamino': (deposit) => buildKaminoDeposit(deposit, rpcUrl),
});

export const landingsWith = (rpcUrl: string): Record<string, LookUpLanding> => ({
  sol: landingsVia(rpcUrl),
});
