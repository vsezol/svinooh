import type { ScanPosition } from '@svinooh/shared';

/**
 * A venue the broad API does not know about.
 *
 * Zerion covers most of DeFi and misses some of it entirely — measured against
 * DeBank on nine production wallets it returned nothing at all for Hyperliquid,
 * which on those wallets was worth $3.0M, $1.3M and $3.5k. A provider closes one
 * such gap by asking that venue itself.
 *
 * This is NOT the same thing as the adapters in scanners/defi. Those only ever
 * refine a position Zerion or DeBank already reported — they answer "is this
 * concentrated position in its band", never "how much is here". A provider adds
 * value that would otherwise be missing, which is a different and more
 * dangerous job: get it wrong and a wallet reads high.
 *
 * So the contract is narrow. A provider returns what one venue holds for one
 * address, zero when it holds nothing, and throws only when it could not find
 * out — the difference matters, because zero is added and a throw is not.
 */
export interface GapProvider {
  /** The name this venue is reported under, and the name Zerion is checked against */
  name: string;
  read(address: string): Promise<ScanPosition[]>;
}
