import type { BuiltDeposit, LookUpLanding } from '../application/deposits';

export async function assemble(
  instructions: unknown[],
  owner: string,
  rpcUrl: string,
): Promise<BuiltDeposit> {
  const kit = await import('@solana/kit');
  const rpc = kit.createSolanaRpc(rpcUrl);
  const signer = kit.createNoopSigner(kit.address(owner));
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const message = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (m) => kit.setTransactionMessageFeePayerSigner(signer, m),
    (m) => kit.setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => kit.appendTransactionMessageInstructions(instructions as never[], m),
  );
  return {
    transaction: kit.getBase64EncodedWireTransaction(kit.compileTransaction(message)),
    feePayer: owner,
    instructions: instructions.length,
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: String(blockhash.lastValidBlockHeight),
  };
}

export const landingsVia =
  (rpcUrl: string): LookUpLanding =>
  async (signature) => {
    const kit = await import('@solana/kit');
    const rpc = kit.createSolanaRpc(rpcUrl);
    const { value } = await rpc
      .getSignatureStatuses([kit.signature(signature)], { searchTransactionHistory: true })
      .send();
    const seen = value[0];
    if (!seen) return { signature, status: 'pending', slot: null, error: null };
    const slot = Number(seen.slot);
    if (seen.err) {
      return { signature, status: 'failed', slot, error: JSON.stringify(seen.err) };
    }
    const settled = seen.confirmationStatus === 'confirmed' || seen.confirmationStatus === 'finalized';
    return { signature, status: settled ? 'landed' : 'pending', slot, error: null };
  };
