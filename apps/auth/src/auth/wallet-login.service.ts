import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { getAddress, verifyMessage } from 'ethers';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@svinooh/db';
import { config } from '../config';

/**
 * Sign-in with a wallet, as EIP-4361 ("Sign-In with Ethereum").
 *
 * Two steps and one signature: we hand the address a sentence to sign, the
 * wallet signs it, and the address that comes back out of the signature is the
 * identity. No transaction, no gas, no allowance — a signed message cannot move
 * anything, which is the thing the message itself says out loud, because the
 * one place a user has to decide whether to trust us is their wallet's prompt.
 *
 * The text is ours and is written down before it is handed out (WalletLogin).
 * Verification compares the signature against THAT row and nothing else, so a
 * browser cannot choose what it signs, and the row is deleted as it is spent,
 * so a signature that leaks is worth nothing the second time.
 *
 * EIP-4361 is worth the shape it imposes: wallets recognise the format and
 * render it as a sign-in rather than as a wall of text, and the domain line is
 * what a phishing site cannot fake — a wallet shows the two side by side.
 */

/** How long a challenge stands. Long enough to find the phone, short enough to matter. */
const TTL_MS = 5 * 60_000;

/** EIP-4361 wants an alphanumeric nonce of at least 8 characters — hex is both */
const nonce = (): string => randomBytes(16).toString('hex');

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
   * The chain id is whatever the wallet is currently on: the signature is the
   * same on every chain, and a message naming a chain the user is not on is
   * what makes some wallets warn about a site that has lost track of them.
   */
  async challenge(addressRaw: string, chainId: number): Promise<{ nonce: string; message: string }> {
    let address: string;
    try {
      // Rejects anything that is not 20 bytes of hex, and a mixed-case address
      // whose checksum does not hold — a typo caught here rather than at signing
      address = getAddress(addressRaw);
    } catch {
      throw new BadRequestException('That is not an Ethereum address');
    }
    if (!Number.isInteger(chainId) || chainId < 1) throw new BadRequestException('Unknown chain');

    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + TTL_MS);
    const token = nonce();
    const message = [
      `${this.domain} wants you to sign in with your Ethereum account:`,
      address,
      '',
      'Sign in to Svinooh. This only proves the address is yours: it is not a transaction, it moves no funds and costs no gas.',
      '',
      `URI: ${config.webUrl}`,
      'Version: 1',
      `Chain ID: ${chainId}`,
      `Nonce: ${token}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${expiresAt.toISOString()}`,
    ].join('\n');

    await this.prisma.walletLogin.create({
      data: { nonce: token, address: address.toLowerCase(), message, expiresAt },
    });
    // Every new challenge clears the ones nobody ever signed — the same sweep
    // TelegramLoginService does, and for the same reason: nothing on a timer
    await this.prisma.walletLogin
      .deleteMany({ where: { expiresAt: { lt: new Date() } } })
      .catch(() => undefined);

    return { nonce: token, message };
  }

  /**
   * The signature came back. Returns the address it proves, lower-case.
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

    let signer: string;
    try {
      signer = verifyMessage(row.message, signature);
    } catch {
      throw new UnauthorizedException('That signature could not be read');
    }
    // A valid signature by the wrong address is not this sign-in: the message
    // names one address, and only that one may redeem it
    if (signer.toLowerCase() !== row.address) {
      throw new UnauthorizedException('That signature is from a different address');
    }
    return row.address;
  }
}
