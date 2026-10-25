import type { FindCoin } from '../application/coins';
import type {
  BuildDeposit,
  LookUpLanding,
  ReadEffects,
  ReadHoldings,
} from '../application/deposits';
import { Logger } from '@nestjs/common';
import type { Decimal } from 'decimal.js';
import type {
  LiquidityBuilders,
  ReadLiquidityPositions,
  ReadNearThePrice,
  ReadPairPool,
  ReadPairPools,
} from '../application/liquidity';
import type {
  BuildMove,
  BuildTakeOut,
  BuildWithdrawal,
  ReadPositions,
} from '../application/moves';
import { coinsVia } from './coins';
import { effectsVia } from './effects';
import { buildKaminoDeposit } from './kamino/deposits';
import { buildKaminoMove, buildKaminoTakeOut } from './kamino/moves';
import { kaminoPositions } from './kamino/positions';
import { buildKaminoWithdrawal } from './kamino/withdrawals';
import {
  buildMeteoraClose,
  buildMeteoraProvide,
  buildMeteoraRebalance,
  nearThePrice,
} from './meteora/liquidity';
import { liquidityPositionsVia, pairPoolsVia, pairPoolVia } from './meteora/pools';
import { holdingsVia, landingsVia } from './solana';

export const buildersWith = (rpcUrl: string): Record<string, BuildDeposit> => ({
  'sol:kamino': (deposit) => buildKaminoDeposit(deposit, rpcUrl),
});

export const landingsWith = (rpcUrl: string): Record<string, LookUpLanding> => ({
  sol: landingsVia(rpcUrl),
});

export const effectsWith = (rpcUrl: string): Record<string, ReadEffects> => ({
  sol: effectsVia(rpcUrl, kaminoPositions(rpcUrl), pairPoolVia()),
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

export const takeOutsWith = (rpcUrl: string): Record<string, BuildTakeOut> => ({
  'sol:kamino': (withdrawal) => buildKaminoTakeOut(withdrawal, rpcUrl),
});

export const movesWith = (rpcUrl: string): Record<string, BuildMove> => ({
  'sol:kamino': (move) => buildKaminoMove(move, rpcUrl),
  sol: (move) => buildKaminoMove(move, rpcUrl),
});

export const coinsWith = (rpcUrl: string): Record<string, FindCoin> => ({
  sol: coinsVia(rpcUrl),
});

export const pairPoolsWith = (): Record<string, ReadPairPools> => ({ sol: pairPoolsVia() });

export const pairPoolWith = (): Record<string, ReadPairPool> => ({ sol: pairPoolVia() });

export const liquidityPositionsWith = (): Record<string, ReadLiquidityPositions> => ({
  sol: liquidityPositionsVia(pairPoolVia()),
});

/** How long what a pool holds near its price is taken as still true. */
const NEAR_KEPT_MS = 60_000;

export const nearThePriceWith = (rpcUrl: string): Record<string, ReadNearThePrice> => {
  const kept = new Map<string, { at: number; value: Decimal }>();
  return {
    sol: async (address, share) => {
      const key = `${address}:${share.toString()}`;
      const known = kept.get(key);
      if (known && known.at > Date.now() - NEAR_KEPT_MS) return known.value;
      try {
        const value = await nearThePrice(address, share, rpcUrl);
        kept.set(key, { at: Date.now(), value });
        return value;
      } catch (failure) {
        new Logger('Liquidity').warn(
          `${address.slice(0, 6)}… near its price could not be read: ${String(failure)}`,
        );
        return null;
      }
    },
  };
};

export const liquidityWith = (rpcUrl: string): Record<string, LiquidityBuilders> => ({
  'sol:meteora': {
    provide: (provide) => buildMeteoraProvide(provide, rpcUrl),
    close: (close, pool) => buildMeteoraClose(close, pool, rpcUrl),
    rebalance: (rebalance, pool, carried) => buildMeteoraRebalance(rebalance, pool, rpcUrl, carried),
  },
});
