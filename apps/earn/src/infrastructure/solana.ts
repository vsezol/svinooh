import { Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { BuiltDeposit, LookUpLanding, ReadHoldings } from '../application/deposits';
import { DepositNotSupported, DepositWouldFail } from '../application/errors';
import { whyItWouldFail, type Deposit } from '../domain/deposit';
import type { Pool } from '../domain/pool';

type Kit = typeof import('@solana/kit');
type Rpc = ReturnType<Kit['createSolanaRpc']>;

const PACKET_BYTES = 1232;

const NATIVE = 'So11111111111111111111111111111111111111112';

/** Rent for the accounts a deposit opens, and the fee to send it. */
const KEPT_BACK = new Decimal('0.01');

export async function assemble(
  deposit: Deposit,
  instructions: unknown[],
  rpcUrl: string,
  lookups: string[] = [],
): Promise<BuiltDeposit> {
  const owner = deposit.owner;
  const kit = await import('@solana/kit');
  const rpc = kit.createSolanaRpc(rpcUrl);
  const signer = kit.createNoopSigner(kit.address(owner));
  // Finalized, not the kit's default of confirmed. A wallet simulates what it is
  // handed exactly as it is, and a simulator reading the finalized bank does
  // not know a confirmed blockhash for another dozen seconds: Phantom answered
  // "Failed to simulate the results of this request" and three screens of
  // UNSAFE for a transaction that went through the moment it was forced.
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: 'finalized' }).send();
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
  await tried(rpc, transaction, deposit.pool.token.symbol);
  return {
    transaction,
    feePayer: owner,
    instructions: instructions.length,
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: String(blockhash.lastValidBlockHeight),
  };
}

/**
 * The wallet will simulate this before it shows anybody a signature prompt,
 * and a wallet that cannot simulate it says so in red. Better to find out here
 * and say why in words than to hand somebody a transaction that burns a fee to
 * fail.
 *
 * Simulated the way a wallet will: as handed over, blockhash and all, against
 * the finalized bank. Replacing the blockhash would test the instructions and
 * miss the one thing that made every wallet refuse to simulate a transaction
 * the chain was happy to run.
 *
 * A simulator we cannot reach, or one that does not know a blockhash it was
 * just handed, is not evidence about the deposit, so neither refuses it.
 */
async function tried(rpc: Rpc, transaction: string, token: string): Promise<void> {
  const outcome = await rpc
    .simulateTransaction(transaction as never, {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: 'finalized',
    })
    .send()
    .catch(() => null);
  const err = outcome?.value?.err;
  if (!err) return;
  if (err === 'BlockhashNotFound') {
    new Logger('Deposits').warn('the simulator did not know a finalized blockhash; not refusing on that');
    return;
  }
  throw new DepositWouldFail(whyItWouldFail(err, outcome.value.logs ?? [], token));
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

export const holdingsVia =
  (rpcUrl: string): ReadHoldings =>
  async (owner, pool) => {
    try {
      return await holdings(rpcUrl, owner, pool);
    } catch (unreachable) {
      new Logger('Holdings').warn(
        `could not read ${owner.slice(0, 6)}… on ${pool.id.network}: ${String(unreachable)}`,
      );
      return null;
    }
  };

async function holdings(rpcUrl: string, owner: string, pool: Pool): Promise<Decimal> {
  const kit = await import('@solana/kit');
  const rpc = kit.createSolanaRpc(rpcUrl);
  const held = kit.address(owner);
  if (pool.token.mint === NATIVE) {
    const { value } = await rpc.getBalance(held).send();
    const sol = new Decimal(String(value)).div(new Decimal(10).pow(9));
    return Decimal.max(sol.minus(KEPT_BACK), 0);
  }
  const { value } = await rpc
    .getTokenAccountsByOwner(held, { mint: kit.address(pool.token.mint) }, { encoding: 'jsonParsed' })
    .send();
  const base = value.reduce(
    (all, one) => all.plus(new Decimal(one.account.data.parsed.info.tokenAmount.amount)),
    new Decimal(0),
  );
  return base.div(new Decimal(10).pow(pool.token.decimals ?? 0));
}
