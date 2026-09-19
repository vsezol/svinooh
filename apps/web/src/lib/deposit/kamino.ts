import type { KaminoVault } from '@kamino-finance/klend-sdk';
import type { BuiltDeposit, DepositRequest } from './types';

type SdkRpc = ConstructorParameters<typeof KaminoVault>[0];

const SLOT_DURATION_MS = 450;

export const KAMINO = 'kamino';
export const SOLANA = 'sol';

export class DepositNotSupportedError extends Error {}

export async function buildDeposit(
  request: DepositRequest,
  owner: string,
  rpcUrl: string,
): Promise<BuiltDeposit> {
  if (request.network !== SOLANA || request.protocol !== KAMINO) {
    throw new DepositNotSupportedError(
      `${request.protocol} on ${request.network} cannot be deposited into from here yet`,
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
      ? await vaultDeposit(klend, rpc, signer, request, amount)
      : await reserveDeposit(klend, kit, rpc, signer, request, amount);

  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (m) => kit.setTransactionMessageFeePayerSigner(signer, m),
    (m) => kit.setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => kit.appendTransactionMessageInstructions(instructions, m),
  );
  const compiled = kit.compileTransaction(message);
  return {
    transaction: kit.getBase64EncodedWireTransaction(compiled),
    feePayer: owner,
    instructions: instructions.length,
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: String(blockhash.lastValidBlockHeight),
  };
}

async function vaultDeposit(
  klend: typeof import('@kamino-finance/klend-sdk'),
  rpc: SdkRpc,
  signer: ReturnType<typeof import('@solana/kit').createNoopSigner>,
  request: DepositRequest,
  amount: InstanceType<typeof import('decimal.js').default>,
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

async function reserveDeposit(
  klend: typeof import('@kamino-finance/klend-sdk'),
  kit: typeof import('@solana/kit'),
  rpc: SdkRpc,
  signer: ReturnType<typeof import('@solana/kit').createNoopSigner>,
  request: DepositRequest,
  amount: InstanceType<typeof import('decimal.js').default>,
) {
  const market = request.accounts.lendingMarket;
  if (!market) {
    throw new DepositNotSupportedError(`${request.pool} did not come with its lending market`);
  }
  const loaded = await klend.KaminoMarket.load(rpc, kit.address(market), SLOT_DURATION_MS);
  if (!loaded) throw new DepositNotSupportedError(`market ${market} did not load`);
  const decimals = request.accounts.tokenDecimals ?? 0;
  const action = await klend.KaminoAction.buildDepositTxns({
    kaminoMarket: loaded,
    amount: amount.mul(new (await import('decimal.js')).default(10).pow(decimals)).toFixed(0),
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
