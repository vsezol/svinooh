import type { Chain, PositionCategory } from '@svinooh/shared';

export interface ScanPosition {
  symbol: string;
  name?: string | null;
  amount?: number | null;
  priceUsd?: number | null;
  valueUsd: number;
  platform?: string | null;
  category: PositionCategory;
}

export interface ScanResult {
  chain: Chain;
  address: string;
  totalUsd: number;
  positions: ScanPosition[];
  /** Например { defi, gmtrade } для SOL или разбивка по EVM-сетям */
  breakdown?: Record<string, number>;
  /** Активы без цены: логируем и показываем, а не молча съедаем */
  unpriced?: string[];
}
