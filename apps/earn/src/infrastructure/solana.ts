import { Logger } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import type { BuiltTransaction, LookUpLanding, ReadHoldings } from '../application/deposits';
import { DepositNotSupported, DepositWouldFail } from '../application/errors';
import { whyItWouldFail } from '../domain/deposit';
import type { Pool } from '../domain/pool';

type Kit = typeof import('@solana/kit');
type Rpc = ReturnType<Kit['createSolanaRpc']>;

const PACKET_BYTES = 1232;

const NATIVE = 'So11111111111111111111111111111111111111112';

/** Rent for the accounts a deposit opens, and the fee to send it. */
const KEPT_BACK = new Decimal('0.01');

/** Who pays for a transaction, and what to call the token when explaining a refusal. */
export interface Payer {
  owner: string;
  token: string;
}

export async function assemble(
  payer: Payer,
  instructions: unknown[],
  rpcUrl: string,
  lookups: string[] = [],
): Promise<BuiltTransaction> {
  const kit = await import('@solana/kit');
  const rpc = kit.createSolanaRpc(rpcUrl);
  const { transaction, blockhash } = await compile(payer.owner, instructions, rpc, lookups);
  const bytes = Math.ceil((transaction.length * 3) / 4);
  if (bytes > PACKET_BYTES) {
    throw new DepositNotSupported(
      `this transaction is ${bytes} bytes and one may be ${PACKET_BYTES}`,
    );
  }
  await tried(rpc, transaction, payer.token);
  return {
    transaction,
    feePayer: payer.owner,
    instructions: instructions.length,
    blockhash: blockhash.blockhash,
    lastValidBlockHeight: String(blockhash.lastValidBlockHeight),
  };
}

async function compile(owner: string, instructions: unknown[], rpc: Rpc, lookups: string[]) {
  const kit = await import('@solana/kit');
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
  return { transaction, blockhash };
}

/**
 * How much of a token these instructions put in the owner's account, found by
 * running them rather than by predicting it.
 *
 * A vault charges for a withdrawal — on 2026-09-21, 12.001427 USDC of shares
 * came out as 12.000426 — so a move that deposits what the shares are worth
 * asks for money that is not there and fails at the last instruction. The
 * simulator answers with the balance after; the difference is what arrived.
 * The share price only rises between now and the signature, so the real
 * withdrawal brings at least this much.
 */
export async function measure(
  payer: Payer & { mint: string; tokenProgram: string | null },
  instructions: unknown[],
  rpcUrl: string,
  lookups: string[] = [],
): Promise<bigint> {
  const kit = await import('@solana/kit');
  const token = await import('@solana-program/token');
  const rpc = kit.createSolanaRpc(rpcUrl);
  const [account] = await token.findAssociatedTokenPda({
    owner: kit.address(payer.owner),
    mint: kit.address(payer.mint),
    tokenProgram: kit.address(payer.tokenProgram ?? token.TOKEN_PROGRAM_ADDRESS),
  });
  const before = await rpc
    .getTokenAccountBalance(account, { commitment: 'finalized' })
    .send()
    .then(({ value }) => BigInt(value.amount))
    .catch(() => 0n);
  const { transaction } = await compile(payer.owner, instructions, rpc, lookups);
  const outcome = await rpc
    .simulateTransaction(transaction as never, {
      encoding: 'base64',
      sigVerify: false,
      replaceRecentBlockhash: false,
      commitment: 'finalized',
      accounts: { encoding: 'jsonParsed', addresses: [account] },
    })
    .send();
  if (outcome.value.err) {
    throw new DepositWouldFail(
      whyItWouldFail(outcome.value.err, outcome.value.logs ?? [], payer.token),
    );
  }
  const after = (outcome.value.accounts?.[0] as { data?: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } | null)
    ?.data?.parsed?.info?.tokenAmount?.amount;
  if (after === undefined) throw new DepositWouldFail('the simulator did not say what arrived');
  return BigInt(after) - before;
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
