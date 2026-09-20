import type { BuildDeposit, LookUpLanding, ReadHoldings } from '../application/deposits';
import { buildKaminoDeposit } from './kamino/deposits';
import { holdingsVia, landingsVia } from './solana';

export const buildersWith = (rpcUrl: string): Record<string, BuildDeposit> => ({
  'sol:kamino': (deposit) => buildKaminoDeposit(deposit, rpcUrl),
});

export const landingsWith = (rpcUrl: string): Record<string, LookUpLanding> => ({
  sol: landingsVia(rpcUrl),
});

export const holdingsWith = (rpcUrl: string): Record<string, ReadHoldings> => ({
  sol: holdingsVia(rpcUrl),
});
