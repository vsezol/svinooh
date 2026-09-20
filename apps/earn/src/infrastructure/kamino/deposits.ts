import type { KaminoVault } from '@kamino-finance/klend-sdk';
import type { BuiltDeposit } from '../../application/deposits';
import { DepositNotSupported } from '../../application/errors';
import { baseUnits, type Deposit } from '../../domain/deposit';
import { assemble } from '../solana';

type SdkRpc = ConstructorParameters<typeof KaminoVault>[0];
type Sdk = typeof import('@kamino-finance/klend-sdk');
type Kit = typeof import('@solana/kit');
type Signer = ReturnType<Kit['createNoopSigner']>;

const SLOT_DURATION_MS = 450;

const NO_TABLE = '11111111111111111111111111111111';

interface Built {
  instructions: unknown[];
  lookups: string[];
}

export async function buildKaminoDeposit(
  deposit: Deposit,
  rpcUrl: string,
): Promise<BuiltDeposit> {
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
  return assemble(built.instructions, deposit.owner, rpcUrl, built.lookups);
}

function refuse(kind: never): never {
  throw new DepositNotSupported(`kamino ${kind} pools are not wired for deposits here yet`);
}

async function intoVault(klend: Sdk, rpc: SdkRpc, signer: Signer, deposit: Deposit): Promise<Built> {
  const terms = deposit.pool.deposit;
  const vault = new klend.KaminoVault(
    rpc,
    terms.address as never,
    SLOT_DURATION_MS,
    undefined,
    terms.programId as never,
  );
  const state = await vault.getState();
  const client = vault.client;
  const reserves = await client.loadVaultReserves(state);
  const farm = await client.loadVaultFarmState(state);
  const ixs = await client.depositIxs(signer, vault, deposit.amount, reserves, farm, null);
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
