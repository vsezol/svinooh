/**
 * Production addresses the two strategies are checked against.
 *
 * Real wallets, chosen to span four orders of magnitude and the position kinds
 * that actually broke things: Hyperliquid (which Zerion does not cover at all),
 * Aave and Venus lending, Pendle, and one wallet that is mostly illiquid
 * airdrops. They are read, never written to.
 *
 * `maxGapPct` is not a target, it is what was MEASURED — see `note`. A wallet
 * drifting outside its own figure is the signal this file exists for: it means
 * one of the two strategies changed its mind about something, and the note says
 * where to look first.
 */
export interface Fixture {
  address: string;
  /**
   * Percent by which the api strategy may differ from the browser one, above
   * the price drift every wallet is allowed. Zero means drift is all it gets.
   */
  maxGapPct: number;
  note: string;
}

export const WALLETS: readonly Fixture[] = [
  {
    address: '0x3e8734ec146c981e3ed1f6b582d447dde701d90c',
    maxGapPct: 1.5,
    note: '$63M. Venus, Lista/Helio, Pendle, and $3.0M on Hyperliquid. Measured -0.26%; it was -5.5% before the Hyperliquid provider existed, so a return to five percent means that provider has stopped working.'
  },
  {
    address: '0x7bfee91193d9df2ac0bfe90191d40f23c773c060',
    maxGapPct: 2,
    note: '$43M across ~700 positions, $1.3M of it on Hyperliquid. Measured -0.93%, was -4.0% without the provider. The widest position count of the set, so also the most exposed to one asset being repriced between the two reads.'
  },
  {
    address: '0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    maxGapPct: 25,
    note: 'Mostly illiquid airdrops. Measured +22.4%, and unchanged by the Hyperliquid provider because nothing is missing here — the two simply price dust differently and neither is right. It is in the set to keep that disagreement from growing quietly, not because it is expected to close.'
  },
  {
    address: '0x7a587e39c8b1bb54871942ab307ffc8ea11fc198',
    maxGapPct: 0,
    note: '$30k, nine positions. Aave and GMX — the plain case, and the one that should always agree. Measured -0.04%.'
  },
  {
    address: '0xe2dd4d99f7fc9d0acbc73f52c4dc86a2dafdb53e',
    maxGapPct: 0,
    note: '$28k, of which $3.5k sits in a Hyperliquid vault — 12.6% of the wallet. Zerion alone reads it short by exactly that; measured -0.07% with the provider. The sharpest single test of whether Hyperliquid is still being read.'
  },
  {
    address: '0x2ba57f6f174866d40cb24091a2f65e3ada341c92',
    maxGapPct: 0,
    note: '$18k in a single position. The simplest wallet in the set. Measured +0.37%.'
  },
  {
    address: '0xf87ef7e740aea6fa01971e62c7d5dc01504200a5',
    maxGapPct: 0,
    note: '$9k, seven positions, no Hyperliquid. Zerion on its own already agrees here; measured -0.06%.'
  },
];
