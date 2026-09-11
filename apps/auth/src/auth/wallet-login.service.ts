import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@svinooh/db';
import { base58Decode, isSolAddress } from '@svinooh/common';
import { config } from '../config';

/**
 * Sign-in with a Solana wallet.
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
 * A Solana address IS an ed25519 public key — base58 of the 32 raw bytes — so
 * checking a signature needs no library and no network: decode the address,
 * hand the bytes to node's crypto, ask. `verify` returns false where another
 * implementation would throw, which is the answer we want anyway.
 */

/** How long a challenge stands. Long enough to find the wallet, short enough to matter. */
const TTL_MS = 5 * 60_000;

/** Alphanumeric, and long enough that nobody is guessing it inside five minutes */
const newNonce = (): string => randomBytes(16).toString('hex');

/** ed25519 signatures are 64 bytes, always */
const SIGNATURE_BYTES = 64;

@Injectable()
export class WalletLoginService {
  constructor(private readonly prisma: PrismaService) {}

  /** The domain a wallet shows beside the site it is actually talking to */
  private get domain(): string {
    return new URL(config.webUrl).host;
  }

  /** A sentence for this address to sign */
  async challenge(addressRaw: string): Promise<{ nonce: string; message: string }> {
    const address = String(addressRaw || '').trim();
    // Not a regex on length: isSolAddress decodes it and insists on 32 bytes,
    // which is the only thing that makes it a public key rather than a string
    if (!isSolAddress(address)) throw new BadRequestException('That is not a Solana address');

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TTL_MS);
    const nonce = newNonce();
    // Read top to bottom by a person holding a phone, because that is exactly
    // what happens to it: who is asking, which address, what it does and does
    // not do, and the fact that it goes stale.
    const message = [
      `${this.domain} wants you to sign in with your Solana account:`,
      address,
      '',
      'Signing proves the address is yours. It is not a transaction: nothing moves, nothing is approved, and there is no fee.',
      '',
      `URI: ${config.webUrl}`,
      'Version: 1',
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${expiresAt.toISOString()}`,
    ].join('\n');

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
  async verify(nonceRaw: string, signatureRaw: string): Promise<string> {
    const expired = new UnauthorizedException('That sign-in request expired — try again');
    if (!nonceRaw || !signatureRaw) throw new BadRequestException('Missing nonce or signature');

    let row: { address: string; message: string; expiresAt: Date };
    try {
      row = await this.prisma.walletLogin.delete({ where: { nonce: nonceRaw } });
    } catch (err) {
      // P2025: no such row — spent already, swept, or never existed
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw expired;
      throw err;
    }
    if (row.expiresAt < new Date()) throw expired;

    const signature = Buffer.from(signatureRaw, 'base64');
    if (signature.length !== SIGNATURE_BYTES) {
      throw new UnauthorizedException('That signature could not be read');
    }
    if (!this.signed(row.address, row.message, signature)) {
      throw new UnauthorizedException('That signature is not from this address');
    }
    return row.address;
  }

  /** Did this address sign this exact text */
  private signed(address: string, message: string, signature: Buffer): boolean {
    const pubkey = base58Decode(address);
    // The address was checked when the challenge was issued; it is checked
    // again because what comes back out of the database is an input too
    if (!pubkey || pubkey.length !== 32) return false;
    try {
      const key = createPublicKey({
        // The 32 bytes an ed25519 key already is, said in the one format node
        // takes them in without a DER header to hand-assemble
        key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(pubkey).toString('base64url') },
        format: 'jwk',
      });
      return verifySignature(null, Buffer.from(message, 'utf8'), key, signature);
    } catch {
      // A key the curve rejects is a signature that was never going to verify
      return false;
    }
  }
}
