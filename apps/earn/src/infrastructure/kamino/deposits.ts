import type { KaminoVault } from '@kamino-finance/klend-sdk';
import type { BuiltTransaction } from '../../application/deposits';
import { DepositNotSupported } from '../../application/errors';
import { baseUnits, type Deposit } from '../../domain/deposit';
import { assemble } from '../solana';

export type SdkRpc = ConstructorParameters<typeof KaminoVault>[0];
export type Sdk = typeof import('@kamino-finance/klend-sdk');
type Kit = typeof import('@solana/kit');
export type Signer = ReturnType<Kit['createNoopSigner']>;

export const SLOT_DURATION_MS = 450;

export const NO_TABLE = '11111111111111111111111111111111';

export interface Built {
  instructions: unknown[];
  lookups: string[];
}

export async function buildKaminoDeposit(
  deposit: Deposit,
  rpcUrl: string,
): Promise<BuiltTransaction> {
  const kit = await import('@solana/kit');
  const klend = await import('@kamino-finance/klend-sdk');
  const rpc = kit.createSolanaRpc(rpcUrl) as unknown as SdkRpc;
  const signer = kit.createNoopSigner(kit.address(deposit.owner));
  const kind = deposit.pool.id.kind;
  const built =
    kind === 'vault'
      ? await intoVault(klend, rpc, signer, deposit)
      : kind === 'reserve'
        ? await intoReserve(klend, kit, rpc, signer, deposit)
        : refuse(kind);
  return assemble(
    { owner: deposit.owner, token: deposit.pool.token.symbol },
    built.instructions,
    rpcUrl,
    built.lookups,
  );
}

function refuse(kind: never): never {
  throw new DepositNotSupported(`kamino ${kind} pools are not wired for deposits here yet`);
}

export async function intoVault(
  klend: Sdk,
  rpc: SdkRpc,
  signer: Signer,
  deposit: Deposit,
): Promise<Built> {
  return intoLoaded(await loadVault(klend, rpc, deposit.pool), signer, deposit.amount);
}

export type LoadedVault = Awaited<ReturnType<typeof loadVault>>;

/** A vault's state, reserves and farm: everything its deposit needs but the amount. */
export async function loadVault(klend: Sdk, rpc: SdkRpc, pool: Deposit['pool']) {
  const vault = new klend.KaminoVault(
    rpc,
    pool.deposit.address as never,
    SLOT_DURATION_MS,
    undefined,
    pool.deposit.programId as never,
  );
  const state = await vault.getState();
  const reserves = await vault.client.loadVaultReserves(state);
  const farm = await vault.client.loadVaultFarmState(state);
  return { vault, state, reserves, farm };
}

export async function intoLoaded(
  loaded: LoadedVault,
  signer: Signer,
  amount: Deposit['amount'],
): Promise<Built> {
  const { vault, state, reserves, farm } = loaded;
  const ixs = await vault.client.depositIxs(signer, vault, amount, reserves, farm, null);
  const table = String(state.vaultLookupTable);
  return {
    instructions: [
      ...ixs.depositIxs,
      ...ixs.stakeInFarmIfNeededIxs,
      ...ixs.stakeInFlcFarmIfNeededIxs,
    ],
    lookups: table && table !== NO_TABLE ? [table] : [],
  };
}

async function intoReserve(
  klend: Sdk,
  kit: Kit,
  rpc: SdkRpc,
  signer: Signer,
  deposit: Deposit,
): Promise<Built> {
  const market = deposit.pool.deposit.lendingMarket;
  if (!market) {
    throw new DepositNotSupported(`${deposit.pool.name} did not come with its lending market`);
  }
  const loaded = await klend.KaminoMarket.load(rpc, kit.address(market), SLOT_DURATION_MS);
  if (!loaded) throw new DepositNotSupported(`market ${market} did not load`);
  const action = await klend.KaminoAction.buildDepositTxns({
    kaminoMarket: loaded,
    amount: baseUnits(deposit),
    reserveAddress: kit.address(deposit.pool.deposit.address),
    owner: signer,
    obligation: new klend.VanillaObligation(loaded.programId),
    useV2Ixs: true,
    scopeRefreshConfig: undefined,
    currentLedgerInstant: await klend.getCurrentLedgerInstant(rpc),
  });
  return {
    instructions: [
      ...action.computeBudgetIxs,
      ...action.setupIxs,
      ...action.lendingIxs,
      ...action.cleanupIxs,
    ],
    lookups: [],
  };
}
