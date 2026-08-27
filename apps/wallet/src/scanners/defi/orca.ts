import { fetchJson } from '../http';
import { solanaRpc } from './solana-rpc';
import type { PoolFact } from '@svinooh/shared';
import { pairKey } from '@svinooh/common';

const ORCA_API = 'https://api.orca.so/v2/solana';
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
/** The positions endpoint takes a list of mints; this is how many it is asked about at once */
const MINTS_PER_REQUEST = 40;

interface TokenAccounts {
  value?: Array<{
    account?: { data?: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string; decimals?: number } } } } };
  }>;
}

interface OrcaResponse {
  data?: {
    positions?: Array<{
      address: string;
      whirlpoolAddress: string;
      tokenA: string;
      tokenB: string;
      position?: { liquidity?: string; tickLowerIndex: number; tickUpperIndex: number };
      meta: { lowerPrice: number; upperPrice: number; currentPrice: number; feeRate: number; isFullRange?: boolean };
    }>;
    whirlpools?: Record<string, { tickCurrentIndex?: number } | undefined>;
    tokens?: Array<{ address: string; metadata?: { symbol?: string } }>;
  };
}

/**
 * An Orca position is an NFT: a token account holding exactly one unit of a
 * mint with no decimals. That is the only way to find them — so this asks the
 * chain for the wallet's NFTs, then asks Orca which of them are positions. The
 * endpoint quietly ignores mints that are not, so nothing has to be filtered
 * first.
 */
async function positionMints(address: string): Promise<string[]> {
  const mints: string[] = [];
  for (const programId of [TOKEN_PROGRAM, TOKEN_2022_PROGRAM]) {
    const result = await solanaRpc<TokenAccounts>('getTokenAccountsByOwner', [
      address,
      { programId },
      { encoding: 'jsonParsed' },
    ]);
    for (const item of result.value ?? []) {
      const info = item.account?.data?.parsed?.info;
      if (info?.tokenAmount?.amount === '1' && info.tokenAmount.decimals === 0 && info.mint) {
        mints.push(info.mint);
      }
    }
  }
  return mints;
}

/**
 * Whether the price is inside the position's band, from the pool's current tick
 * — the pool's own answer, not a guess from which side the position is holding.
 * A full-range position has no band to leave.
 */
export async function orcaPools(address: string): Promise<PoolFact[]> {
  const mints = await positionMints(address);
  if (!mints.length) return [];

  const positions: NonNullable<NonNullable<OrcaResponse['data']>['positions']> = [];
  const whirlpools: NonNullable<NonNullable<OrcaResponse['data']>['whirlpools']> = {};
  const tokens: NonNullable<NonNullable<OrcaResponse['data']>['tokens']> = [];

  for (let i = 0; i < mints.length; i += MINTS_PER_REQUEST) {
    const chunk = mints.slice(i, i + MINTS_PER_REQUEST);
    const data = await fetchJson<OrcaResponse>(`${ORCA_API}/positions?addresses=${chunk.join(',')}`);
    positions.push(...(data.data?.positions ?? []));
    Object.assign(whirlpools, data.data?.whirlpools ?? {});
    tokens.push(...(data.data?.tokens ?? []));
  }
  if (!positions.length) return [];

  const symbolByMint = new Map(tokens.map((t) => [t.address, t.metadata?.symbol]));
  const sym = (mint: string) => symbolByMint.get(mint) ?? mint.slice(0, 4);

  return positions
    .filter((p) => p.position?.liquidity && p.position.liquidity !== '0')
    .map((p) => {
      const tick = whirlpools[p.whirlpoolAddress]?.tickCurrentIndex;
      const inRange =
        typeof tick === 'number' && p.position
          ? tick >= p.position.tickLowerIndex && tick < p.position.tickUpperIndex
          : p.meta.currentPrice >= p.meta.lowerPrice && p.meta.currentPrice <= p.meta.upperPrice;
      return {
        id: `orca:${p.address}`,
        platform: 'orca' as const,
        pair: pairKey(sym(p.tokenA), sym(p.tokenB)),
        inRange: p.meta.isFullRange ? true : inRange,
        lowerPrice: p.meta.lowerPrice,
        upperPrice: p.meta.upperPrice,
        currentPrice: p.meta.currentPrice,
        priceLabel: `${sym(p.tokenB)} per ${sym(p.tokenA)}`,
        isFullRange: !!p.meta.isFullRange,
      };
    });
}
