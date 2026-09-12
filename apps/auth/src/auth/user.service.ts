import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { Portfolio, User } from '@prisma/client';
import { PrismaService } from '@svinooh/db';
import { getAddress } from 'ethers';
import { detectChain, wordSlug } from '@svinooh/common';

/**
 * How long a sign-in link from the bot stays good. An hour covers the case the
 * link exists for — made on the desktop, opened on the phone a moment later —
 * without leaving a working credential sitting in a chat for the rest of the
 * day. Past that the site says so and offers a new one, which is a press in the
 * bot away.
 */
const LINK_TTL_MS = 60 * 60_000;

/**
 * As much of an address as a person reads off a screen, spelled the way its
 * chain spells it: `0x1a2b…9f0e` with the checksum case wallets show, and
 * `7xKX…gAsU` for base58, which has no case to restore.
 */
const shortAddress = (address: string): string => {
  if (address.length <= 12) return address;
  const hex = detectChain(address) === 'EVM';
  // 0x and four, against base58's four: the prefix is not part of what tells
  // one address from another, and every EVM address shares it
  const shown = hex ? getAddress(address) : address;
  return `${shown.slice(0, hex ? 6 : 4)}…${shown.slice(-4)}`;
};

/**
 * Owns the User record and its portfolio. Split out of AuthService because the
 * bot needs it too: to put a link to the user's own portfolio in its "return to
 * the site" button, it has to resolve the account the moment the login is
 * confirmed — before the site has polled for it. Both callers going through
 * here keeps a single definition of "sign in and make sure a portfolio exists".
 */
@Injectable()
export class UserService {
  constructor(private readonly prisma: PrismaService) {}

  upsertTelegram(p: {
    id: number;
    firstName?: string;
    lastName?: string;
    username?: string;
    photoUrl?: string;
  }): Promise<User> {
    const telegramId = BigInt(p.id);
    const profile = {
      firstName: p.firstName ?? null,
      lastName: p.lastName ?? null,
      username: p.username ?? null,
      // the bot doesn't send a photo — don't overwrite the one already saved from the web widget
      ...(p.photoUrl !== undefined ? { photoUrl: p.photoUrl ?? null } : {}),
    };
    return this.prisma.user.upsert({
      where: { telegramId },
      create: { telegramId, ...profile },
      update: profile,
    });
  }

  /**
   * The X account is its own identity, exactly as a Telegram account is:
   * signing in with X finds or makes the user that IS that X account, and
   * never reaches for a Telegram user to attach to. X has one display name
   * where Telegram has two, so it lands in firstName whole.
   */
  upsertX(p: { id: string; name?: string; username?: string; photoUrl?: string }): Promise<User> {
    const profile = {
      firstName: p.name ?? null,
      lastName: null,
      username: p.username ?? null,
      photoUrl: p.photoUrl ?? null,
    };
    return this.prisma.user.upsert({
      where: { xId: p.id },
      create: { xId: p.id, ...profile },
      update: profile,
    });
  }

  /**
   * A wallet is its own identity too, and the same rule holds: signing in with
   * an address finds or makes the user that IS that address, and never reaches
   * for a Telegram or X account to attach to.
   *
   * The name is the shortened address, because a wallet gives us nothing else
   * and "Anonymous" everywhere is worse than the one fact we do have. It is
   * public chain data — the one kind of name the privacy rule allows to be
   * generated — and, like every other handle, it is shown to its owner and to
   * nobody else. Nothing to update on a return visit: an address does not
   * change its mind about what it is called.
   */
  upsertWallet(address: string): Promise<User> {
    return this.prisma.user.upsert({
      where: { walletAddress: address },
      create: { walletAddress: address, firstName: shortAddress(address) },
      update: {},
    });
  }

  /**
   * Point this user's alerts at a Telegram chat. A delivery address and only
   * that: the chat's own Telegram account, if it ever signs in, is a different
   * user — nothing here reads or writes telegramId.
   */
  bindAlertChat(userId: string, chatId: number): Promise<User> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { alertChatId: BigInt(chatId) },
    });
  }

  unbindAlertChat(userId: string): Promise<User> {
    return this.prisma.user.update({ where: { id: userId }, data: { alertChatId: null } });
  }

  /**
   * The portfolio is created on first sign-in. Just one for now; the schema
   * allows several.
   *
   * It is created PRIVATE (`PortfolioOwner.isPublic` defaults to false) and
   * WITHOUT a name: the slug identifies it. An auto-generated name is public the
   * moment the owner publishes, so it must never be derived from who they are —
   * and a placeholder like "My portfolio" reads as nonsense to everyone else.
   *
   * A wallet account's portfolio is created holding that wallet — see
   * `startsHolding`.
   */
  async ensurePortfolio(user: User): Promise<Portfolio> {
    const existing = await this.prisma.portfolioOwner.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
      include: { portfolio: true },
    });
    if (existing) return existing.portfolio;
    // Word slugs collide once in ~260k — the unique constraint arbitrates and a
    // hit just deals a new hand (digits join after a couple of misses)
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.prisma.portfolio.create({
          data: {
            slug: wordSlug(attempt),
            owner: { create: { userId: user.id } },
            wallets: this.startsHolding(user),
          },
        });
      } catch (err) {
        const collision =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
        if (!collision || attempt >= 5) throw err;
      }
    }
  }

  /**
   * What a new portfolio is created holding: for a wallet account, the address
   * it signed in with — watching that address is the entire reason somebody
   * signs in with a wallet, and asking them to paste it on the next screen is
   * asking them to repeat themselves.
   *
   * It rides inside the statement that creates the portfolio, and that is the
   * whole design. Creating a portfolio happens once per account, so seeding it
   * happens once per account — there is no second moment at which this could
   * run, which means a wallet somebody deletes afterwards stays deleted. Doing
   * it from the browser after signing in could not promise that: the client
   * cannot tell a sign-up from a sign-in, and the request it would send is one
   * the person did not ask for a second time.
   *
   * Atomic for the same reason: portfolio, ownership, membership and the
   * address itself are one write. A half-done version of this is a portfolio
   * that was supposed to have a wallet and never will.
   *
   * The address row is created due (`Wallet.nextScanAt` defaults to now), so
   * the producer's next pass takes it — a few seconds, and no call into the
   * wallet service from here to arrange it.
   */
  private startsHolding(user: User): Prisma.PortfolioCreateInput['wallets'] {
    const address = user.walletAddress;
    const chain = address ? detectChain(address) : null;
    if (!address || !chain) return undefined;
    return {
      create: {
        wallet: {
          // Somebody else may already be tracking this address — then it is
          // that same row, with its readings and its history already on it
          connectOrCreate: {
            where: { chain_address: { chain, address } },
            create: { chain, address },
          },
        },
      },
    };
  }

  /**
   * Mint a link that signs its opener in. The bot puts it in the chat, so it is
   * a bearer credential sitting in a place that already grants this account:
   * whoever can read the chat can press Start and get a fresh one anyway.
   *
   * Issuing supersedes the user's earlier links, so an old message — forwarded,
   * screenshotted, left on a shared screen — stops working the moment they sign
   * in again. Expired rows from every user are swept on the way past.
   */
  async issueLoginLink(userId: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.loginLink.deleteMany({
        where: { OR: [{ userId }, { expiresAt: { lt: now } }] },
      }),
      this.prisma.loginLink.create({
        data: { token, userId, expiresAt: new Date(now.getTime() + LINK_TTL_MS) },
      }),
    ]);
    return token;
  }
}
