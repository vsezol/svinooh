import { Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { ReadEffects } from '../application/deposits';
import type { ReadPairPool } from '../application/liquidity';
import type { ReadPositions } from '../application/moves';
import {
  coinsMoved,
  isFresh,
  NATIVE_SOL,
  poolsTouched,
  sharesMints,
  type CoinAfter,
  type Effects,
  type Moved,
  type PairAfter,
  type TokenBalance,
  type VaultAfter,
} from '../domain/effects';
import type { PairPool } from '../domain/liquidity';
import type { Pool } from '../domain/pool';
import type { Position } from '../domain/withdrawal';
import { listingsOf, type Listing } from './coins';
import { ownedInPair, pairsAmong, type PairReading } from './meteora/liquidity';

const WRAPPED_SOL = 'So11111111111111111111111111111111111111112';

export const effectsVia =
  (rpcUrl: string, readVaults: ReadPositions, readPairPool: ReadPairPool): ReadEffects =>
  async (signature, owner, pools) => {
    try {
      return await effectsOf(signature, owner, pools, rpcUrl, readVaults, readPairPool);
    } catch (unreadable) {
      new Logger('Effects').warn(
        `could not read what ${signature.slice(0, 8)}… left behind: ${String(unreadable)}`,
      );
      return null;
    }
  };

interface WireBalance {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string; decimals: number };
}

interface WireKey {
  pubkey: string;
  writable: boolean;
  signer: boolean;
}

interface PairRead {
  pool: PairPool;
  reading: PairReading;
}

type PriceOf = (mint: string) => Decimal | null;

async function effectsOf(
  signature: string,
  owner: string,
  pools: Pool[],
  rpcUrl: string,
  readVaults: ReadPositions,
  readPairPool: ReadPairPool,
): Promise<Effects | null> {
  const kit = await import('@solana/kit');
  const found = await kit
    .createSolanaRpc(rpcUrl)
    .getTransaction(kit.signature(signature), {
      encoding: 'jsonParsed',
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    })
    .send();
  if (!found?.meta || found.meta.err) return null;
  const blockTime = found.blockTime === null ? null : Number(found.blockTime);
  if (!isFresh(blockTime, new Date())) return null;
  const keys = found.transaction.message.accountKeys as unknown as WireKey[];
  const ownerAt = keys.findIndex((key) => String(key.pubkey) === owner);
  if (ownerAt < 0) return null;

  const touched = poolsTouched(pools, new Set(keys.map((key) => String(key.pubkey))));
  if (touched.unreadable.length) return null;
  const shares = sharesMints(pools);
  const moved = coinsMoved(
    owner,
    balancesOf(found.meta.preTokenBalances as unknown as WireBalance[]),
    balancesOf(found.meta.postTokenBalances as unknown as WireBalance[]),
    BigInt(found.meta.postBalances[ownerAt]),
  ).filter((one) => !shares.has(one.mint));

  const written = keys.filter((key) => key.writable && !key.signer).map((key) => String(key.pubkey));
  const [held, pairs] = await Promise.all([
    readVaults(owner, touched.vaults),
    pairsRead(await pairsAmong(written, rpcUrl), owner, rpcUrl, readPairPool),
  ]);
  const listed = await listingsOf([
    WRAPPED_SOL,
    ...moved.map((one) => one.mint),
    ...touched.vaults.map((pool) => pool.token.mint),
    ...pairs.flatMap(({ pool }) => [pool.x.mint, pool.y.mint]),
  ]);
  const named = new Set(keys.map((key) => String(key.pubkey)));
  const priceOf: PriceOf = (mint) =>
    listed.get(mint === NATIVE_SOL ? WRAPPED_SOL : mint)?.priceUsd ?? null;

  const vaults = touched.vaults.map((pool) => vaultAfter(pool, held, priceOf));
  const unpriced =
    vaults.some((one) => one.priceUsd === null) ||
    pairs.some(({ pool }) => priceOf(pool.x.mint) === null || priceOf(pool.y.mint) === null);
  if (unpriced) return null;
  return {
    slot: Number(found.slot),
    coins: moved.map((one) => coinAfter(one, listed)),
    vaults,
    pairs: pairs.map((pair) => pairAfter(pair, priceOf, named)),
  };
}

function balancesOf(wire: WireBalance[] | null | undefined): TokenBalance[] {
  return (wire ?? []).flatMap((one) =>
    one.owner
      ? [
          {
            mint: String(one.mint),
            owner: String(one.owner),
            amount: one.uiTokenAmount.amount,
            decimals: one.uiTokenAmount.decimals,
          },
        ]
      : [],
  );
}

function coinAfter(moved: Moved, listed: Map<string, Listing>): CoinAfter {
  const listing = listed.get(moved.mint === NATIVE_SOL ? WRAPPED_SOL : moved.mint);
  return {
    mint: moved.mint,
    symbol: listing?.symbol ?? `${moved.mint.slice(0, 4)}…`,
    amount: moved.amount,
    priceUsd: listing?.priceUsd ?? null,
  };
}

function vaultAfter(pool: Pool, held: Position[], priceOf: PriceOf): VaultAfter {
  const position = held.find((one) => one.pool.id.address === pool.id.address);
  return { pool, amount: position?.amount ?? new Decimal(0), priceUsd: priceOf(pool.token.mint) };
}

async function pairsRead(
  addresses: string[],
  owner: string,
  rpcUrl: string,
  readPairPool: ReadPairPool,
): Promise<PairRead[]> {
  const read = await Promise.all(
    addresses.map(async (address) => {
      const [pool, reading] = await Promise.all([
        readPairPool(address),
        ownedInPair(address, owner, rpcUrl),
      ]);
      return pool ? [{ pool: { ...pool, price: reading.price }, reading }] : [];
    }),
  );
  return read.flat();
}

function pairAfter({ pool, reading }: PairRead, priceOf: PriceOf, named: Set<string>): PairAfter {
  const priceX = priceOf(pool.x.mint) ?? new Decimal(0);
  const priceY = priceOf(pool.y.mint) ?? new Decimal(0);
  const usdOf = (x: Decimal, y: Decimal) => x.mul(priceX).plus(y.mul(priceY));
  return {
    pool,
    priceX,
    priceY,
    positions: reading.positions.map((one) => ({
      address: one.address,
      pool,
      lowerPrice: one.lowerPrice,
      upperPrice: one.upperPrice,
      inRange: one.inRange,
      amountX: one.amountX,
      amountY: one.amountY,
      valueUsd: usdOf(one.amountX, one.amountY),
      feesUsd: usdOf(one.feeX, one.feeY),
    })),
    touched: reading.positions.filter((one) => named.has(one.address)).map((one) => one.address),
  };
}
