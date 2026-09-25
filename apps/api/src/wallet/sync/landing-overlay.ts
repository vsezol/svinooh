import { Injectable } from '@nestjs/common';
import type { ScanPosition, ScanPositionToken, ScanResult } from '@svinooh/shared';

export interface CoinAfterLanding {
  mint: string;
  symbol: string;
  amount: number;
  priceUsd: number | null;
}

export interface VaultAfterLanding {
  address: string;
  farm: string | null;
  sharesMint: string | null;
  name: string;
  token: string;
  amount: number;
  priceUsd: number;
  apy: number | null;
}

export interface PairPositionAfterLanding {
  address: string;
  amountX: number;
  amountY: number;
  lowerPrice: number;
  upperPrice: number;
  inRange: boolean;
  feesUsd: number;
}

export interface PairAfterLanding {
  address: string;
  x: string;
  y: string;
  feePct: number | null;
  price: number;
  priceXUsd: number;
  priceYUsd: number;
  positions: PairPositionAfterLanding[];
}

export interface WalletAfterLanding {
  slot: number;
  coins: CoinAfterLanding[];
  vaults: VaultAfterLanding[];
  pairs: PairAfterLanding[];
}

export const HELD_MS = 3 * 60_000;

const DUST_USD = 0.01;

@Injectable()
export class LandingOverlay {
  private readonly held = new Map<string, { until: number; after: WalletAfterLanding }>();

  hold(walletId: string, after: WalletAfterLanding, now = Date.now()): void {
    const earlier = this.standing(walletId, now);
    this.held.set(walletId, {
      until: now + HELD_MS,
      after: earlier ? laterWins(earlier, after) : after,
    });
  }

  over(walletId: string, result: ScanResult, now = Date.now()): ScanResult {
    const after = this.standing(walletId, now);
    return after ? overlaid(result, after) : result;
  }

  private standing(walletId: string, now: number): WalletAfterLanding | null {
    const held = this.held.get(walletId);
    if (!held) return null;
    if (held.until > now) return held.after;
    this.held.delete(walletId);
    return null;
  }
}

export function overlaid(result: ScanResult, after: WalletAfterLanding): ScanResult {
  let positions = result.positions;
  let moved = 0;
  const replace = (belongs: (position: ScanPosition) => boolean, rows: ScanPosition[]) => {
    const at = positions.findIndex(belongs);
    const kept = positions.filter((position) => !belongs(position));
    moved += total(rows) - total(positions.filter(belongs));
    positions = at < 0 ? [...kept, ...rows] : [...kept.slice(0, at), ...rows, ...kept.slice(at)];
  };
  for (const coin of after.coins) {
    const belongs = (position: ScanPosition) => position.platform === 'wallet' && position.ref === coin.mint;
    const seen = positions.find(belongs);
    const price = seen?.priceUsd ?? coin.priceUsd;
    if (price === null || price === undefined) continue;
    replace(belongs, coinRows(coin, price, seen?.symbol));
  }
  for (const vault of after.vaults) replace(inVault(vault), vaultRows(vault));
  for (const pair of after.pairs) replace((position) => position.pool === pair.address, pairRows(pair));
  const defi = result.breakdown?.defi;
  return {
    ...result,
    totalUsd: result.totalUsd + moved,
    positions,
    ...(typeof defi === 'number' ? { breakdown: { ...result.breakdown, defi: defi + moved } } : {}),
  };
}

function laterWins(held: WalletAfterLanding, arrived: WalletAfterLanding): WalletAfterLanding {
  const [older, newer] = arrived.slot >= held.slot ? [held, arrived] : [arrived, held];
  const by = <T>(key: (one: T) => string, before: T[], after: T[]): T[] => [
    ...before.filter((one) => !after.some((other) => key(other) === key(one))),
    ...after,
  ];
  return {
    slot: newer.slot,
    coins: by((one) => one.mint, older.coins, newer.coins),
    vaults: by((one) => one.address, older.vaults, newer.vaults),
    pairs: by((one) => one.address, older.pairs, newer.pairs),
  };
}

const total = (priced: Array<{ valueUsd: number }>): number =>
  priced.reduce((sum, one) => sum + one.valueUsd, 0);

function coinRows(coin: CoinAfterLanding, priceUsd: number, symbol?: string): ScanPosition[] {
  const valueUsd = coin.amount * priceUsd;
  if (valueUsd < DUST_USD) return [];
  return [
    {
      symbol: symbol ?? coin.symbol,
      amount: coin.amount,
      priceUsd,
      valueUsd,
      platform: 'wallet',
      category: 'token',
      network: 'sol',
      ref: coin.mint,
    },
  ];
}

const inVault = (vault: VaultAfterLanding) => (position: ScanPosition) =>
  (position.platform === 'wallet' && vault.sharesMint !== null && position.ref === vault.sharesMint) ||
  position.pool === vault.address ||
  (vault.farm !== null && position.pool === vault.farm);

function vaultRows(vault: VaultAfterLanding): ScanPosition[] {
  const valueUsd = vault.amount * vault.priceUsd;
  if (valueUsd < DUST_USD) return [];
  return [
    {
      symbol: 'Kamino',
      name: 'Vault',
      note: vault.name,
      valueUsd,
      platform: 'kamino',
      category: 'defi',
      network: 'sol',
      apy: vault.apy,
      pool: vault.address,
      tokens: [
        { symbol: vault.token, amount: vault.amount, priceUsd: vault.priceUsd, valueUsd, role: 'supply' },
      ],
    },
  ];
}

function pairRows(pair: PairAfterLanding): ScanPosition[] {
  const label = `${pair.x}/${pair.y}`;
  return pair.positions.flatMap((one) => {
    const legs: ScanPositionToken[] = [
      { symbol: pair.x, amount: one.amountX, priceUsd: pair.priceXUsd, valueUsd: one.amountX * pair.priceXUsd, role: 'supply' },
      { symbol: pair.y, amount: one.amountY, priceUsd: pair.priceYUsd, valueUsd: one.amountY * pair.priceYUsd, role: 'supply' },
      { symbol: label, amount: null, priceUsd: null, valueUsd: one.feesUsd, role: 'reward' },
    ].filter((leg) => leg.valueUsd >= DUST_USD) as ScanPositionToken[];
    const valueUsd = total(legs);
    if (valueUsd < DUST_USD) return [];
    return [
      {
        symbol: 'Meteora',
        name: 'Liquidity Pool',
        note: label,
        valueUsd,
        platform: 'meteora',
        category: 'defi',
        network: 'sol',
        ref: one.address,
        pool: pair.address,
        range: one.inRange ? 'in' : 'out',
        band: {
          pair: label,
          feePct: pair.feePct,
          chainLabel: 'Solana',
          lower: one.lowerPrice,
          upper: one.upperPrice,
          current: pair.price,
          priceLabel: `${pair.y} per ${pair.x}`,
        },
        tokens: legs,
      },
    ];
  });
}
