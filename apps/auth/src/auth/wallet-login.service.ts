import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createPublicKey, randomBytes, verify as verifyEd25519 } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';
import { Prisma } from '@prisma/client';
import type { Chain } from '@svinooh/shared';
import { PrismaService } from '@svinooh/db';
import { base58Decode, detectChain, normalizeAddress } from '@svinooh/common';
import { config } from '../config';

/**
 * Sign-in with a wallet, on either chain that can sign one.
 *
 * Two steps and one signature: we hand the address a sentence to sign, the
 * wallet signs it, and an address that can produce that signature is the
 * address. No transaction, no gas, no approval — a signed message cannot move
 * anything, which is what the message itself says out loud, because the
 * wallet's prompt is the one place somebody decides whether to trust us.
 *
 * The text is ours and is written down before it is handed out (WalletLogin).
 * Verification compares the signature against THAT row and nothing else, so a
 * browser cannot choose what it signs; the row is deleted as it is spent, so a
 * signature that leaks is worth nothing the second time.
 *
 * The chain is never asked for and never stored: an address says which one it
 * is on, which is the same question `detectChain` already answers for every
 * address somebody pastes. It decides the shape of the message, how the
 * signature is spelled, and which of the two proofs below applies:
 *
 *  - **SOL** — the address IS an ed25519 public key, base58 of the 32 raw
 *    bytes. Decode it, hand the bytes to node's crypto, ask. No library, no
 *    node, no network.
 *  - **EVM** — the address is the hash of a key we do not have, so the key is
 *    recovered from the signature and compared. That is ethers' `verifyMessage`,
 *    and it is the whole of what ethers is here for.
 */

/** How long a challenge stands. Long enough to find the wallet, short enough to matter. */
const TTL_MS = 5 * 60_000;

/** Alphanumeric, and long enough that nobody is guessing it inside five minutes */
const newNonce = (): string => randomBytes(16).toString('hex');

/** ed25519 signatures are 64 bytes, always */
const SOL_SIGNATURE_BYTES = 64;

/** The two chains a sign-in can come from. BTC and TRON have no such flow. */
const CAN_SIGN: readonly Chain[] = ['SOL', 'EVM'];

@Injectable()
export class WalletLoginService {
  constructor(private readonly prisma: PrismaService) {}

  /** The domain a wallet shows beside the site it is actually talking to */
  private get domain(): string {
    return new URL(config.webUrl).host;
  }

  /**
   * A sentence for this address to sign.
   *
   * `chainId` is the EVM network the wallet is currently on — a message naming
   * a chain the user is not on is what makes some wallets warn about a site
   * that has lost track of them. Solana signs the same on every cluster and
   * names none.
   */
  async challenge(addressRaw: string, chainId: number): Promise<{ nonce: string; message: string }> {
    const raw = String(addressRaw || '').trim();
    const chain = detectChain(raw);
    if (!chain || !CAN_SIGN.includes(chain)) {
      throw new BadRequestException('That is not a Solana or Ethereum address');
    }
    // The one spelling we store everywhere else, so the wallet this account is
    // given holds the same string the address box would have produced
    const address = normalizeAddress(chain, raw);

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TTL_MS);
    const nonce = newNonce();
    const message = this.sentence({ chain, address, chainId, nonce, issuedAt, expiresAt });

    await this.prisma.walletLogin.create({ data: { nonce, address, message, expiresAt } });
    // Every new challenge clears the ones nobody ever signed — the same sweep
    // TelegramLoginService does, and for the same reason: nothing on a timer
    await this.prisma.walletLogin
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => undefined);

    return { nonce, message };
  }

  /**
   * The signature came back. Returns the address it proves.
   *
   * The row is deleted first and the signature checked afterwards, deliberately:
   * `delete` is one statement, so two requests racing the same nonce cannot both
   * get the row, and a wrong signature spending the challenge is correct — the
   * next attempt asks for a new one, which is a press of the same button.
   */
  async verify(nonceRaw: string, signature: string): Promise<string> {
    const expired = new UnauthorizedException('That sign-in request expired — try again');
    if (!nonceRaw || !signature) throw new BadRequestException('Missing nonce or signature');

    let row: { address: string; message: string; expiresAt: Date };
    try {
      row = await this.prisma.walletLogin.delete({ where: { nonce: nonceRaw } });
    } catch (err) {
      // P2025: no such row — spent already, swept, or never existed
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw expired;
      throw err;
    }
    if (row.expiresAt < new Date()) throw expired;

    const signed =
      detectChain(row.address) === 'SOL'
        ? this.signedBySolana(row.address, row.message, signature)
        : this.signedByEvm(row.address, row.message, signature);
    if (!signed) throw new UnauthorizedException('That signature is not from this address');
    return row.address;
  }

  /**
   * The text itself — EIP-4361 ("Sign-In with Ethereum") and the shape Solana
   * borrowed from it, which is why one builder writes both. Wallets recognise
   * the format and render it as a sign-in rather than as a wall of text, and
   * the domain line is what a phishing site cannot fake: a wallet shows it
   * beside the site it is really talking to.
   *
   * Read top to bottom by a person holding a phone, because that is exactly
   * what happens to it: who is asking, which address, what it does and does not
   * do, and the fact that it goes stale.
   */
  private sentence(p: {
    chain: Chain;
    address: string;
    chainId: number;
    nonce: string;
    issuedAt: Date;
    expiresAt: Date;
  }): string {
    const solana = p.chain === 'SOL';
    return [
      `${this.domain} wants you to sign in with your ${solana ? 'Solana' : 'Ethereum'} account:`,
      // EIP-4361 wants the checksummed spelling, which is also the one the
      // wallet will show; base58 has no such thing and is left as it is
      solana ? p.address : getAddress(p.address),
      '',
      'Signing proves the address is yours. It is not a transaction: nothing moves, nothing is approved, and there is no fee.',
      '',
      `URI: ${config.webUrl}`,
      'Version: 1',
      ...(solana ? [] : [`Chain ID: ${p.chainId}`]),
      `Nonce: ${p.nonce}`,
      `Issued At: ${p.issuedAt.toISOString()}`,
      `Expiration Time: ${p.expiresAt.toISOString()}`,
    ].join('\n');
  }

  /** Did this Solana address sign this exact text — base64 of 64 raw bytes */
  private signedBySolana(address: string, message: string, signature: string): boolean {
    const pubkey = base58Decode(address);
    // The address was checked when the challenge was issued; it is checked
    // again because what comes back out of the database is an input too
    if (!pubkey || pubkey.length !== 32) return false;
    const bytes = Buffer.from(signature, 'base64');
    if (bytes.length !== SOL_SIGNATURE_BYTES) return false;
    try {
      const key = createPublicKey({
        // The 32 bytes an ed25519 key already is, said in the one format node
        // takes them in without a DER header to hand-assemble
        key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pubkey).toString('base64url') },
        format: 'jwk',
      });
      return verifyEd25519(null, Buffer.from(message, 'utf8'), key, bytes);
    } catch {
      // A key the curve rejects is a signature that was never going to verify
      return false;
    }
  }

  /** Did this EVM address sign this exact text — 0x-hex, and the signer is recovered */
  private signedByEvm(address: string, message: string, signature: string): boolean {
    try {
      return verifyMessage(message, signature).toLowerCase() === address;
    } catch {
      // Malformed hex, a wrong length, an impossible v — all of them mean no
      return false;
    }
  }
}
