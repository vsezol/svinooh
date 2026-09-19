import type { BuiltDeposit } from '../application/deposits';

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
