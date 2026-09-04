import { Logger } from '@nestjs/common';
import type { ScanPosition } from '@svinooh/shared';
import type { GapProvider } from './provider';

const logger = new Logger('Hyperliquid');
const API = 'https://api.hyperliquid.xyz/info';
const TIMEOUT_MS = 15_000;

/**
 * What an address holds on Hyperliquid, from Hyperliquid.
 *
 * Zerion reports nothing here — not a smaller number, nothing — so without this
 * a wallet on Hyperliquid reads short by however much it holds there. Measured
 * against DeBank on the three production wallets that hold any:
 *
 *     $3,015,840 -> $3,011,599   99.9%
 *     $1,341,090 -> $1,334,775   99.5%
 *         $3,516 ->     $3,516  100.0%
 *
 * The residue is the price moving between two reads, not disagreement.
 *
 * `portfolio` is the whole account in one call — perps margin, spot, staked
 * HYPE and vault equity together — which is what the page shows and what the
 * total needs. The parts are available separately (clearinghouseState,
 * spotClearinghouseState, delegatorSummary, userVaultEquities) and are not
 * fetched: four requests to break down a figure nothing displays broken down
 * is four times the rate limit for nothing.
 *
 * Rate limit is 1200 weight per minute per IP and this request weighs 20, so
 * sixty addresses a minute — about three hundred wallets at a five minute
 * refresh. Not a ceiling we are near.
 */
interface PortfolioWindow {
  accountValueHistory?: Array<[number, string]>;
}

async function accountValue(address: string): Promise<number> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'portfolio', user: address }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`hyperliquid answered ${res.status}`);

  // [["day", {...}], ["week", {...}], …] — the windows share an account value,
  // so any of them will do and `day` is the one that is always present
  const windows = (await res.json()) as Array<[string, PortfolioWindow]>;
  const day = Array.isArray(windows) ? windows.find((w) => w[0] === 'day') : undefined;
  const history = day?.[1]?.accountValueHistory;
  if (!Array.isArray(history)) {
    throw new Error('hyperliquid answered without an account value history');
  }
  // An address that has never traded there comes back with an empty history,
  // which is a real answer: it holds nothing
  if (history.length === 0) return 0;

  const value = Number(history[history.length - 1][1]);
  if (!Number.isFinite(value)) throw new Error('hyperliquid account value is not a number');
  return value;
}

export const hyperliquid: GapProvider = {
  name: 'Hyperliquid',
  async read(address: string): Promise<ScanPosition[]> {
    const value = await accountValue(address);
    if (value < 0.01) return [];
    logger.debug?.(`${address}: hyperliquid $${value.toFixed(2)}`);
    return [
      {
        symbol: 'Hyperliquid',
        name: 'Deposit',
        note: 'hyperliquid',
        network: 'hyperliquid',
        valueUsd: value,
        platform: 'hyperliquid',
        category: 'defi',
        healthRate: null,
        range: null,
        // No legs: this is the account value the exchange itself reports, and
        // splitting it into perps, spot and staked would be four more requests
        // for detail the page does not show
        tokens: [],
      },
    ];
  },
};
