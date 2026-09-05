import { Injectable, Logger } from '@nestjs/common';
import type { ProPayOptionDto } from '@svinooh/shared';
import { NowPaymentsClient } from './nowpayments.client';

/**
 * Which coins the checkout leads with: stables, on the networks our users
 * actually hold, in preference order — USDT on TRON first the moment it fits.
 *
 * "Fits" is the catch. The gateway's per-coin minimum is driven by network
 * fees, and TRON's puts USDT-TRC20 at over 11 USD as of 2026-09 — an invoice
 * for less, locked to it, would be unpayable. So this list is a preference,
 * not a promise: what is actually offered is filtered against the live
 * minimums for the price being charged, and the day the price clears TRON's
 * bar (or their fee promo returns), TRC-20 takes the default back by itself.
 */
export const PAY_RAILS: readonly ProPayOptionDto[] = [
  { code: 'usdttrc20', label: 'USDT · TRON' },
  { code: 'usdtton', label: 'USDT · TON' },
  { code: 'usdtbsc', label: 'USDT · BNB Chain' },
  { code: 'usdtsol', label: 'USDT · Solana' },
  { code: 'usdterc20', label: 'USDT · Ethereum' },
  { code: 'usdcsol', label: 'USDC · Solana' },
  { code: 'usdcbsc', label: 'USDC · BNB Chain' },
  { code: 'usdcbase', label: 'USDC · Base' },
];

/** The rails whose known minimum fits the price, in preference order */
export function railOptions(
  minUsdByCode: ReadonlyMap<string, number>,
  priceUsd: number,
): ProPayOptionDto[] {
  return PAY_RAILS.filter((rail) => {
    const min = minUsdByCode.get(rail.code);
    return min !== undefined && min <= priceUsd;
  });
}

/** How long a minimum is believed. Fees drift, not spike — half an hour is honest. */
const MINIMUMS_TTL_MS = 30 * 60_000;

@Injectable()
export class PayRailsService {
  private readonly logger = new Logger(PayRailsService.name);
  /** code → USD minimum, kept as one batch so the options never mix vintages */
  private known = new Map<string, number>();
  private fetchedAt = 0;
  private refreshing: Promise<void> | null = null;

  constructor(private readonly nowpayments: NowPaymentsClient) {}

  async options(priceUsd: number): Promise<ProPayOptionDto[]> {
    return railOptions(await this.minimums(), priceUsd);
  }

  /** Whether this rail may carry this price — what checkout checks before locking */
  async viable(code: string, priceUsd: number): Promise<boolean> {
    if (!PAY_RAILS.some((rail) => rail.code === code)) return false;
    const min = (await this.minimums()).get(code);
    return min !== undefined && min <= priceUsd;
  }

  /**
   * The gateway's per-rail minimums, refreshed at most every half hour and
   * shared by every concurrent caller. A rail whose minimum cannot be read is
   * left out of the batch — unpickable rather than wrongly promised — and a
   * refresh that fails outright keeps serving the last batch it had.
   */
  private async minimums(): Promise<ReadonlyMap<string, number>> {
    if (!this.nowpayments.enabled) return this.known;
    if (Date.now() - this.fetchedAt < MINIMUMS_TTL_MS) return this.known;
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
    return this.known;
  }

  private async refresh(): Promise<void> {
    const read = await Promise.all(
      PAY_RAILS.map(async (rail) => {
        const usd = await this.nowpayments.minAmountUsd(rail.code).catch(() => null);
        return [rail.code, usd] as const;
      }),
    );
    const next = new Map<string, number>();
    for (const [code, usd] of read) if (usd !== null) next.set(code, usd);
    if (next.size === 0 && this.known.size > 0) {
      this.logger.warn('could not read any pay-rail minimums — keeping the previous batch');
      return;
    }
    this.known = next;
    this.fetchedAt = Date.now();
  }
}
