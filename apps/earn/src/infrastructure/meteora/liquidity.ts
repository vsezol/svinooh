import type BN from 'bn.js';
import { Decimal } from 'decimal.js';
import type { BuiltTransaction, Then } from '../../application/deposits';
import { DepositNotSupported, NothingThere } from '../../application/errors';
import {
  balance,
  evenRange,
  MAX_BINS,
  pairIdOf,
  spanOf,
  whyNotRange,
  type Close,
  type PairPool,
  type PairToken,
  type Provide,
  type Range,
  type Rebalance,
} from '../../domain/liquidity';
import { kaminoRoutes, ROOMY, SLIPPAGE_BPS, TIGHT } from '../kamino/swap';
import { assemble, attempts, budgeted } from '../solana';

type Sdk = typeof import('@meteora-ag/dlmm');
type Dlmm = Sdk['default'];
type Pool = Awaited<ReturnType<Dlmm['create']>>;
type Web3 = typeof import('@solana/web3.js');

const NATIVE = 'So11111111111111111111111111111111111111112';

/** How far the active bin may move between building and landing before an add refuses, in percent. */
const ACTIVE_SLIPPAGE_PCT = 1;

/**
 * The DLMM SDK, through require. Its ESM build does not load under Node —
 * it asks anchor for a named export anchor's CommonJS does not give — and
 * its CommonJS one does, with the class standing in for the module.
 */
function sdk() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const loaded = require('@meteora-ag/dlmm') as Sdk & { default?: Dlmm };
  return {
    DLMM: (loaded.default ?? loaded) as unknown as Dlmm,
    StrategyType: loaded.StrategyType,
    autoFillYByStrategy: loaded.autoFillYByStrategy,
    getPriceOfBinByBinId: loaded.getPriceOfBinByBinId,
    getAccountDiscriminator: loaded.getAccountDiscriminator,
    program: loaded.LBCLMM_PROGRAM_IDS['mainnet-beta'],
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    web3: require('@solana/web3.js') as Web3,
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    BN: require('bn.js') as typeof BN,
  };
}

async function opened(rpcUrl: string, address: string): Promise<Pool> {
  const { DLMM, web3 } = sdk();
  return DLMM.create(new web3.Connection(rpcUrl, 'confirmed'), new web3.PublicKey(address));
}

const READONLY = 0;
const WRITABLE = 1;
const SIGNER = 2;

/** web3.js instructions, as the kit composes them. */
async function composed(
  instructions: InstanceType<Web3['TransactionInstruction']>[],
): Promise<unknown[]> {
  const kit = await import('@solana/kit');
  return instructions.map((one) => ({
    programAddress: kit.address(one.programId.toBase58()),
    accounts: one.keys.map((key) => ({
      address: kit.address(key.pubkey.toBase58()),
      role: (key.isSigner ? SIGNER : READONLY) + (key.isWritable ? WRITABLE : READONLY),
    })),
    data: Uint8Array.from(one.data),
  }));
}

const base = (amount: Decimal, token: PairToken): string =>
  amount.mul(new Decimal(10).pow(token.decimals)).toFixed(0, Decimal.ROUND_DOWN);

const tokens = (amount: string | { toString(): string }, token: PairToken): Decimal =>
  new Decimal(amount.toString()).div(new Decimal(10).pow(token.decimals));

const percent = (fraction: Decimal): string => fraction.mul(100).toDecimalPlaces(4).toFixed();

const both = (pool: PairPool): string => `${pool.x.symbol} and ${pool.y.symbol}`;

const ACCOUNTS_PER_READ = 100;

export interface OwnedInPair {
  address: string;
  amountX: Decimal;
  amountY: Decimal;
  feeX: Decimal;
  feeY: Decimal;
  lowerPrice: Decimal;
  upperPrice: Decimal;
  inRange: boolean;
}

export interface PairReading {
  price: Decimal;
  positions: OwnedInPair[];
}

export async function pairsAmong(accounts: string[], rpcUrl: string): Promise<string[]> {
  const kit = await import('@solana/kit');
  const { getAccountDiscriminator, program } = sdk();
  const discriminator = Buffer.from(getAccountDiscriminator('lbPair'));
  const rpc = kit.createSolanaRpc(rpcUrl);
  const pairs: string[] = [];
  for (let at = 0; at < accounts.length; at += ACCOUNTS_PER_READ) {
    const chunk = accounts.slice(at, at + ACCOUNTS_PER_READ);
    const { value } = await rpc
      .getMultipleAccounts(
        chunk.map((one) => kit.address(one)),
        { encoding: 'base64', dataSlice: { offset: 0, length: discriminator.length } },
      )
      .send();
    value.forEach((account, index) => {
      if (!account || String(account.owner) !== program) return;
      if (Buffer.from(account.data[0], 'base64').equals(discriminator)) pairs.push(chunk[index]);
    });
  }
  return pairs;
}

export async function ownedInPair(address: string, owner: string, rpcUrl: string): Promise<PairReading> {
  const { web3, getPriceOfBinByBinId } = sdk();
  const dlmm = await opened(rpcUrl, address);
  const { activeBin, userPositions } = await dlmm.getPositionsByUserAndLbPair(new web3.PublicKey(owner));
  const binStep = dlmm.lbPair.binStep;
  const priceAt = (binId: number) =>
    new Decimal(dlmm.fromPricePerLamport(Number(getPriceOfBinByBinId(binId, binStep))));
  const inX = (base: { toString(): string }) =>
    new Decimal(base.toString()).div(new Decimal(10).pow(dlmm.tokenX.mint.decimals));
  const inY = (base: { toString(): string }) =>
    new Decimal(base.toString()).div(new Decimal(10).pow(dlmm.tokenY.mint.decimals));
  return {
    price: new Decimal(activeBin.pricePerToken),
    positions: userPositions.map(({ publicKey, positionData }) => ({
      address: publicKey.toBase58(),
      amountX: inX(positionData.totalXAmount),
      amountY: inY(positionData.totalYAmount),
      feeX: inX(positionData.feeX),
      feeY: inY(positionData.feeY),
      lowerPrice: priceAt(positionData.lowerBinId),
      upperPrice: priceAt(positionData.upperBinId),
      inRange: positionData.lowerBinId <= activeBin.binId && activeBin.binId <= positionData.upperBinId,
    })),
  };
}

/**
 * Liquidity placed across a range around the price, in one position.
 *
 * Every bin under the price holds the pool's y and every bin over it its x,
 * so what goes in is first brought to the mix the range takes: the token
 * there is too much of is swapped for the other, through Kamino Swap, as a
 * step of its own. Then the position is opened and filled in one
 * transaction, which the new position's own key signs first — a key made
 * here for that one signature and never kept.
 */
export async function buildMeteoraProvide(provide: Provide, rpcUrl: string): Promise<BuiltTransaction> {
  const { pool, range } = provide;
  const why = whyNotRange(range, pool);
  if (why) throw new DepositNotSupported(why);
  const { StrategyType, autoFillYByStrategy, BN } = sdk();
  const dlmm = await opened(rpcUrl, pool.id.address);
  const active = await dlmm.getActiveBin();
  const binStep = dlmm.lbPair.binStep;
  const span = spanOf(range, binStep);
  const minBinId = active.binId + span.lower;
  const maxBinId = active.binId + span.upper;
  const unit = new BN(10).pow(new BN(pool.x.decimals));
  const perUnit = autoFillYByStrategy(
    active.binId,
    binStep,
    unit,
    active.xAmount,
    active.yAmount,
    minBinId,
    maxBinId,
    StrategyType.Spot,
  );
  const plan = balance(
    provide.amountX,
    provide.amountY,
    new Decimal(active.pricePerToken),
    tokens(perUnit, pool.y),
  );
  if (plan.swap) return swapFirst(provide, plan.swap, plan.amount, rpcUrl);
  return place(provide, dlmm, minBinId, maxBinId, rpcUrl);
}

async function place(
  provide: Provide,
  dlmm: Pool,
  minBinId: number,
  maxBinId: number,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const kit = await import('@solana/kit');
  const { StrategyType, web3, BN } = sdk();
  const { pool, owner } = provide;
  const key = await kit.generateKeyPairSigner();
  const transaction = await dlmm.initializePositionAndAddLiquidityByStrategy({
    positionPubKey: new web3.PublicKey(key.address),
    totalXAmount: new BN(base(provide.amountX, pool.x)),
    totalYAmount: new BN(base(provide.amountY, pool.y)),
    strategy: { minBinId, maxBinId, strategyType: StrategyType.Spot },
    user: new web3.PublicKey(owner),
    slippage: ACTIVE_SLIPPAGE_PCT,
  });
  const instructions = await budgeted(await composed(transaction.instructions));
  return assemble({ owner, token: both(pool) }, instructions, rpcUrl, [], [key.keyPair]);
}

async function swapFirst(
  provide: Provide,
  side: 'x' | 'y',
  amount: Decimal,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const { pool, owner, range } = provide;
  const [from, to] = side === 'x' ? [pool.x, pool.y] : [pool.y, pool.x];
  const trying = attempts(owner, rpcUrl);
  let offered = 0;
  for (const maxAccounts of [ROOMY, TIGHT]) {
    const routes = await kaminoRoutes({
      tokenIn: from.mint,
      tokenOut: to.mint,
      amount: BigInt(base(amount, from)),
      owner,
      slippageBps: SLIPPAGE_BPS,
      maxAccounts,
      wrapSol: from.mint === NATIVE || to.mint === NATIVE,
    });
    offered += routes.length;
    for (const route of routes) {
      const all = await budgeted(route.instructions);
      const built = await trying.one(all, { known: route.tables }, {
        token: from.symbol,
        decimals: from.decimals,
      });
      if (!built) continue;
      const got = tokens(route.guaranteed, to);
      const [x, y] =
        side === 'x'
          ? [provide.amountX.minus(amount), provide.amountY.plus(got)]
          : [provide.amountX.plus(got), provide.amountY.minus(amount)];
      return { ...built, then: providing(pool, x, y, range) };
    }
  }
  throw (
    trying.refused() ??
    new DepositNotSupported(
      offered
        ? `no swap from ${from.symbol} to ${to.symbol} fits in a transaction right now`
        : `nobody will swap ${from.symbol} for ${to.symbol} right now`,
    )
  );
}

const providing = (pool: PairPool, x: Decimal, y: Decimal, range: Range): Then => ({
  action: 'provide',
  poolId: pairIdOf(pool.id),
  amountX: Decimal.max(x, 0).toDecimalPlaces(pool.x.decimals, Decimal.ROUND_DOWN).toFixed(),
  amountY: Decimal.max(y, 0).toDecimalPlaces(pool.y.decimals, Decimal.ROUND_DOWN).toFixed(),
  belowPct: percent(range.below),
  abovePct: percent(range.above),
  holding: both(pool),
});

async function exists(address: string, rpcUrl: string): Promise<boolean> {
  const { web3 } = sdk();
  const account = await new web3.Connection(rpcUrl, 'confirmed').getAccountInfo(
    new web3.PublicKey(address),
  );
  return account !== null;
}

/** A position as the chain has it, with its pool, once it is known to be this owner's. */
async function positioned(address: string, owner: string, rpcUrl: string) {
  const { web3 } = sdk();
  const connection = new web3.Connection(rpcUrl, 'confirmed');
  const key = new web3.PublicKey(address);
  const account = await connection.getAccountInfo(key);
  if (!account) throw new NothingThere(`there is no position at ${address}`);
  // A position opens with its pool and its owner: 8 bytes of what it is, then the two addresses.
  const lbPair = new web3.PublicKey(account.data.subarray(8, 40));
  const holder = new web3.PublicKey(account.data.subarray(40, 72));
  if (holder.toBase58() !== owner) {
    throw new DepositNotSupported('that position belongs to another wallet');
  }
  const dlmm = await opened(rpcUrl, lbPair.toBase58());
  const position = await dlmm.getPosition(key);
  return { dlmm, key, data: position.positionData };
}

/** The first of the transactions that empty a position, and whether more follow it. */
async function emptying(address: string, owner: string, rpcUrl: string) {
  const { web3, BN } = sdk();
  const found = await positioned(address, owner, rpcUrl);
  const chunks = await found.dlmm.removeLiquidity({
    user: new web3.PublicKey(owner),
    position: found.key,
    fromBinId: found.data.lowerBinId,
    toBinId: found.data.upperBinId,
    bps: new BN(10_000),
    shouldClaimAndClose: true,
  });
  if (!chunks.length) throw new NothingThere(`the position at ${address} has nothing to take out`);
  const instructions = await budgeted(await composed(chunks[0].instructions));
  return { ...found, instructions, more: chunks.length > 1 };
}

/**
 * A position emptied — everything out, fees claimed, the account closed and
 * its rent returned. A wide position takes more than one transaction to
 * empty; each is built from what is left once the one before has landed.
 */
export async function buildMeteoraClose(
  close: Close,
  pool: PairPool,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const { instructions, more } = await emptying(close.position, close.owner, rpcUrl);
  const built = await assemble({ owner: close.owner, token: both(pool) }, instructions, rpcUrl);
  return more
    ? { ...built, then: { action: 'close', position: close.position, holding: both(pool) } }
    : built;
}

/**
 * A position closed and what it held placed again around the price. What
 * comes back is known from the position itself — what it holds of each token
 * and the fees it has earned — so the next step is built for exactly that
 * once the position is gone. With no range given, the new one is as many
 * bins wide as the old, as far down as up.
 */
export async function buildMeteoraRebalance(
  rebalance: Rebalance,
  pool: PairPool,
  rpcUrl: string,
  carried: { amountX: Decimal; amountY: Decimal } | null = null,
): Promise<BuiltTransaction> {
  // A step before this one may have emptied and closed the position already;
  // what it held is in the wallet, and placing it is all that is left.
  if (carried && rebalance.range && !(await exists(rebalance.position, rpcUrl))) {
    const { owner, range } = rebalance;
    return buildMeteoraProvide({ pool, owner, range, ...carried }, rpcUrl);
  }
  const { data, instructions, more } = await emptying(rebalance.position, rebalance.owner, rpcUrl);
  const back = carried ?? {
    amountX: tokens(data.totalXAmountExcludeTransferFee, pool.x).plus(
      tokens(data.feeXExcludeTransferFee, pool.x),
    ),
    amountY: tokens(data.totalYAmountExcludeTransferFee, pool.y).plus(
      tokens(data.feeYExcludeTransferFee, pool.y),
    ),
  };
  const width = Math.min(data.upperBinId - data.lowerBinId + 1, MAX_BINS);
  const range = rebalance.range ?? evenRange(width, pool.binStep);
  const built = await assemble(
    { owner: rebalance.owner, token: both(pool) },
    instructions,
    rpcUrl,
  );
  const next: Then = more
    ? {
        ...providing(pool, back.amountX, back.amountY, range),
        action: 'rebalance',
        position: rebalance.position,
      }
    : providing(pool, back.amountX, back.amountY, range);
  return { ...built, then: next };
}
