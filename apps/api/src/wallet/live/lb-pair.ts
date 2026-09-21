/**
 * The one number a DLMM pool's account has to give up for this to work: the
 * bin its price is currently in.
 *
 * A Meteora pool is a row of bins, each a fixed step wide, and `activeId` says
 * which of them the price sits in right now. A position is a contiguous run of
 * bins, so "is it in range" is `lower <= active <= upper` — integers, no
 * conversion, no rounding, and the same answer Meteora's own API gives for the
 * same position.
 *
 * The offset is read rather than deserialised, because deserialising it would
 * mean the Anchor IDL, a client library and a dependency tree for four bytes.
 * `LbPair` opens with two fixed-size parameter blocks (32 bytes each, after the
 * 8-byte discriminator), then a bump, the bin-step seed and the pair type — 76
 * bytes before `active_id`. Verified against mainnet rather than counted off a
 * struct: the SOL-USDC pool read active_id -5405 and bin_step 4 at 76 and 80,
 * the bin step matched what the API reports for that pool, and
 * (1 + 4/10_000)^-5405 · 10^(9-6) came out at 115.12 against a SOL price of
 * 115.14. The test carries a real account so a layout change fails here.
 */
const ACTIVE_ID_OFFSET = 76;

/**
 * The widest bin id the program itself will accept, either way from the middle.
 *
 * A guard, not a limit of ours: if an upgrade ever moves the field, four bytes
 * of something else read as an int are overwhelmingly likely to land outside
 * this, and a number that cannot be a bin is refused rather than believed. The
 * cost of being wrong here is telling somebody their position left its range
 * when it did not.
 */
const MAX_BIN_ID = 443_636;

/** Which bin this pool's price is in, or null if the bytes are not an LbPair */
export function activeBinId(account: Buffer): number | null {
  if (account.length < ACTIVE_ID_OFFSET + 4) return null;
  const id = account.readInt32LE(ACTIVE_ID_OFFSET);
  return Math.abs(id) > MAX_BIN_ID ? null : id;
}

/** Bins a position was opened between — the two ends are its own */
export interface Bins {
  lowerBinId: number;
  upperBinId: number;
}

export const holds = (bins: Bins, activeBinId: number): boolean =>
  activeBinId >= bins.lowerBinId && activeBinId <= bins.upperBinId;
