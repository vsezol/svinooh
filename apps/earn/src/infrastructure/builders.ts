import type { BuildDeposit, LookUpLanding, ReadHoldings } from '../application/deposits';
import type { BuildMove, BuildWithdrawal, ReadPositions } from '../application/moves';
import { buildKaminoDeposit } from './kamino/deposits';
import { kaminoPositions } from './kamino/positions';
import { buildKaminoMove, buildKaminoWithdrawal } from './kamino/withdrawals';
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

export const positionsWith = (rpcUrl: string): Record<string, ReadPositions> => ({
  sol: kaminoPositions(rpcUrl),
});

export const withdrawalsWith = (rpcUrl: string): Record<string, BuildWithdrawal> => ({
  'sol:kamino': (withdrawal) => buildKaminoWithdrawal(withdrawal, rpcUrl),
});

export const movesWith = (rpcUrl: string): Record<string, BuildMove> => ({
  'sol:kamino': (move) => buildKaminoMove(move, rpcUrl),
});
