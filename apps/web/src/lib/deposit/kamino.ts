import type { KaminoVault } from '@kamino-finance/klend-sdk';
import { assemble } from './solana';
import { DepositNotSupportedError, type BuiltDeposit, type DepositRequest } from './types';

type SdkRpc = ConstructorParameters<typeof KaminoVault>[0];
type Sdk = typeof import('@kamino-finance/klend-sdk');
type Amount = InstanceType<typeof import('decimal.js').default>;

const SLOT_DURATION_MS = 450;
const KINDS = ['vault', 'reserve'];

export async function buildKaminoDeposit(
  request: DepositRequest,
  owner: string,
  rpcUrl: string,
): Promise<BuiltDeposit> {
  if (!KINDS.includes(request.poolKind)) {
    throw new DepositNotSupportedError(
      `kamino ${request.poolKind} pools are not wired for deposits here yet`,
    );
  }
  const kit = await import('@solana/kit');
  const klend = await import('@kamino-finance/klend-sdk');
  const { default: Decimal } = await import('decimal.js');
  const rpc = kit.createSolanaRpc(rpcUrl) as unknown as SdkRpc;
  const signer = kit.createNoopSigner(kit.address(owner));
  const amount = new Decimal(request.amount);
  const instructions =
    request.poolKind === 'vault'
      ? await intoVault(klend, rpc, signer, request, amount)
      : await intoReserve(klend, kit, rpc, signer, request, amount, Decimal);
  return assemble(instructions, owner, rpcUrl);
}

async function intoVault(
  klend: Sdk,
  rpc: SdkRpc,
  signer: ReturnType<typeof import('@solana/kit').createNoopSigner>,
  request: DepositRequest,
  amount: Amount,
) {
  const vault = new klend.KaminoVault(
    rpc,
    request.accounts.address as never,
    SLOT_DURATION_MS,
    undefined,
    request.accounts.programId as never,
  );
  const state = await vault.getState();
  const client = vault.client;
  const reserves = await client.loadVaultReserves(state);
  const farm = await client.loadVaultFarmState(state);
  const ixs = await client.depositIxs(signer, vault, amount, reserves, farm, null);
  return [...ixs.depositIxs, ...ixs.stakeInFarmIfNeededIxs, ...ixs.stakeInFlcFarmIfNeededIxs];
}

async function intoReserve(
  klend: Sdk,
  kit: typeof import('@solana/kit'),
  rpc: SdkRpc,
  signer: ReturnType<typeof import('@solana/kit').createNoopSigner>,
  request: DepositRequest,
  amount: Amount,
  Decimal: typeof import('decimal.js').default,
) {
  const market = request.accounts.lendingMarket;
  if (!market) {
    throw new DepositNotSupportedError(`${request.pool} did not come with its lending market`);
  }
  const loaded = await klend.KaminoMarket.load(rpc, kit.address(market), SLOT_DURATION_MS);
  if (!loaded) throw new DepositNotSupportedError(`market ${market} did not load`);
  const action = await klend.KaminoAction.buildDepositTxns({
    kaminoMarket: loaded,
    amount: amount.mul(new Decimal(10).pow(request.accounts.tokenDecimals ?? 0)).toFixed(0),
    reserveAddress: kit.address(request.accounts.address),
    owner: signer,
    obligation: new klend.VanillaObligation(loaded.programId),
    useV2Ixs: true,
    scopeRefreshConfig: undefined,
    currentLedgerInstant: await klend.getCurrentLedgerInstant(rpc),
  });
  return [
    ...action.computeBudgetIxs,
    ...action.setupIxs,
    ...action.lendingIxs,
    ...action.cleanupIxs,
  ];
}
