import type { BuiltDeposit, LookUpLanding } from '../application/deposits';
import { DepositNotSupported } from '../application/errors';

const PACKET_BYTES = 1232;

export async function assemble(
  instructions: unknown[],
  owner: string,
  rpcUrl: string,
  lookups: string[] = [],
): Promise<BuiltDeposit> {
  const kit = await import('@solana/kit');
  const rpc = kit.createSolanaRpc(rpcUrl);
  const signer = kit.createNoopSigner(kit.address(owner));
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const written = kit.pipe(
    kit.createTransactionMessage({ version: 0 }),
    (m) => kit.setTransactionMessageFeePayerSigner(signer, m),
    (m) => kit.setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => kit.appendTransactionMessageInstructions(instructions as never[], m),
  );
  const message = lookups.length
    ? kit.compressTransactionMessageUsingAddressLookupTables(
        written,
        await kit.fetchAddressesForLookupTables(lookups.map(kit.address), rpc),
      )
    : written;
  const transaction = kit.getBase64EncodedWireTransaction(kit.compileTransaction(message));
  const bytes = Math.ceil((transaction.length * 3) / 4);
  if (bytes > PACKET_BYTES) {
    throw new DepositNotSupported(
      `this deposit is ${bytes} bytes and a transaction may be ${PACKET_BYTES}`,
    );
  }
  return {
    transaction,
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
