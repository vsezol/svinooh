import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sleep } from '@svinooh/common';
import { PrismaService } from '@svinooh/db';
import type { Chain, TransferDto, TransfersDto } from '@svinooh/shared';
import { readPage, type Transfer } from './transfer-sources';

export interface HeldAddress {
  /** PortfolioWallet id — what WalletDto.id is */
  id: string;
  chain: Chain;
  address: string;
  /** When the address entered the system; history starts here */
  since: Date;
}

/** Below this a transaction is dust or spam, not money moving */
const MIN_USD = 1;
/** A history caught up this recently is not read again when the tab opens */
const FRESH_MS = 15 * 60_000;
/** A catch-up re-reads this much before where it stopped: sources index a little late */
const OVERLAP_MS = 60 * 60_000;
/** What one tab open may spend per address; the background walks the rest */
const PAGES_ON_VIEW = 3;
/**
 * How long a tab open waits for its catch-up. Telling a plain transfer from
 * DeFi takes a look at every transaction, so a first pass can run for minutes;
 * a short catch-up lands in this answer, a long pass carries on behind it.
 */
const VIEW_WAIT_MS = 3_000;
const PAGES_IN_BACKGROUND = 5;
const ADDRESSES_PER_TICK = 2;
const RETRY_MS = 5 * 60_000;

/**
 * Every plain transfer of every tracked address since it entered the system,
 * stored, so the list and later the real return can be read off the database.
 *
 * A pass reads newest-first down to a floor and saves its place after every
 * page: the first pass goes down to `since`, a catch-up to just under where the
 * last one stopped. The background only finishes unfinished passes, and only for
 * owned portfolios — Zerion allows 2,000 requests a day, and a landing search
 * is not worth spending them on. Catching up happens when the tab is opened,
 * which is enough: a catch-up reads down to where the history stopped however
 * long ago that was, so nothing in between is lost.
 */
@Injectable()
export class TransferHistory {
  private readonly logger = new Logger(TransferHistory.name);
  private readonly passes = new Map<string, Promise<void>>();
  private ticking = false;

  constructor(private readonly prisma: PrismaService) {}

  async forPortfolio(wallets: HeldAddress[]): Promise<TransfersDto> {
    if (!wallets.length) return { transfers: [], unread: [], loading: [] };
    await Promise.race([Promise.all(wallets.map((w) => this.catchUp(w, PAGES_ON_VIEW, FRESH_MS))), sleep(VIEW_WAIT_MS)]);

    const [cursors, rows] = await Promise.all([
      this.prisma.addressTransferCursor.findMany({
        where: { OR: wallets.map((w) => ({ chain: w.chain, address: w.address })) },
      }),
      this.prisma.addressTransfer.findMany({
        where: { OR: wallets.map((w) => ({ chain: w.chain, address: w.address, minedAt: { gte: w.since } })) },
      }),
    ]);
    const cursorOf = (w: HeldAddress) => cursors.find((c) => c.chain === w.chain && c.address === w.address);
    const read = wallets.map((wallet) => ({
      wallet,
      transfers: rows
        .filter((r) => r.chain === wallet.chain && r.address === wallet.address)
        .map((r): Transfer => ({ ...r, at: r.minedAt, direction: r.direction as Transfer['direction'] })),
    }));

    return {
      transfers: crossings(read, wallets),
      unread: wallets.filter((w) => cursorOf(w)?.lastError).map((w) => w.id),
      loading: wallets
        .filter((w) => !cursorOf(w)?.syncedTo || cursorOf(w)?.passCursor || this.passes.has(`${w.chain}:${w.address}`))
        .map((w) => w.id),
    };
  }

  @Interval('transfer-history', 60_000)
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const due = await this.prisma.$queryRaw<Array<{ chain: Chain; address: string; since: Date }>>`
        SELECT w."chain", w."address", w."createdAt" AS "since"
        FROM "Wallet" w
        LEFT JOIN "AddressTransferCursor" c ON c."chain" = w."chain" AND c."address" = w."address"
        WHERE (c."chain" IS NULL OR c."syncedTo" IS NULL OR c."passCursor" IS NOT NULL)
          AND (c."retryAt" IS NULL OR c."retryAt" <= now())
          AND EXISTS (
            SELECT 1 FROM "PortfolioWallet" pw
            JOIN "PortfolioOwner" o ON o."portfolioId" = pw."portfolioId"
            WHERE pw."walletId" = w."id"
          )
        ORDER BY c."updatedAt" ASC NULLS FIRST
        LIMIT ${ADDRESSES_PER_TICK}
      `;
      for (const wallet of due) await this.catchUp(wallet, PAGES_IN_BACKGROUND, 0);
    } catch (error) {
      this.logger.warn(`tick failed: ${(error as Error).message}`);
    } finally {
      this.ticking = false;
    }
  }

  /** One pass per address at a time: a tab open and the background share it */
  private catchUp(w: Omit<HeldAddress, 'id'>, maxPages: number, freshMs: number): Promise<void> {
    const key = `${w.chain}:${w.address}`;
    const running = this.passes.get(key);
    if (running) return running;
    const pass = this.pass(w, maxPages, freshMs).finally(() => this.passes.delete(key));
    this.passes.set(key, pass);
    return pass;
  }

  private async pass({ chain, address, since }: Omit<HeldAddress, 'id'>, maxPages: number, freshMs: number) {
    const where = { chain_address: { chain, address } };
    const state = await this.prisma.addressTransferCursor.upsert({ where, create: { chain, address, since }, update: {} });
    const now = Date.now();
    if (state.lastError && state.retryAt.getTime() > now) return;
    if (!state.passCursor && state.syncedTo && now - state.syncedTo.getTime() < freshMs) return;

    const floor =
      state.passFloor ?? new Date(Math.max(state.since.getTime(), (state.syncedTo?.getTime() ?? 0) - OVERLAP_MS));
    const startedAt = state.passStartedAt ?? new Date(now);
    let cursor = state.passCursor;
    try {
      for (let pages = 0; pages < maxPages; pages++) {
        const page = await readPage(chain, address, floor, cursor);
        await this.prisma.addressTransfer.createMany({
          skipDuplicates: true,
          data: page.transfers.map(({ at, ...t }) => ({ chain, address, minedAt: at, ...t })),
        });
        cursor = page.next;
        await this.prisma.addressTransferCursor.update({
          where,
          data: cursor
            ? { passCursor: cursor, passFloor: floor, passStartedAt: startedAt, lastError: null }
            : { syncedTo: startedAt, passCursor: null, passFloor: null, passStartedAt: null, lastError: null },
        });
        if (!cursor) return;
      }
    } catch (error) {
      const message = (error as Error).message.slice(0, 300);
      this.logger.warn(`${chain} ${address.slice(0, 8)}… transfers: ${message}`);
      await this.prisma.addressTransferCursor.update({
        where,
        data: { lastError: message, retryAt: new Date(Date.now() + RETRY_MS) },
      });
    }
  }
}

const spell = (address: string): string => (address.startsWith('0x') ? address.toLowerCase() : address);

/**
 * What crossed the portfolio's edge: every transfer whose other side is not one
 * of the portfolio's own addresses, one row per wallet, transaction and
 * direction, worth a dollar or more. A transfer between two of its wallets is a
 * move, not money in or out.
 */
export function crossings(
  read: Array<{ wallet: Pick<HeldAddress, 'id' | 'chain'>; transfers: Transfer[] }>,
  perimeter: Array<Pick<HeldAddress, 'address'>>,
): TransferDto[] {
  const own = new Set(perimeter.map((w) => spell(w.address)));
  const rows = new Map<string, TransferDto>();

  for (const { wallet, transfers } of read) {
    for (const t of transfers) {
      if (t.counterparty && own.has(spell(t.counterparty))) continue;
      const key = `${wallet.id}:${t.txHash}:${t.direction}`;
      const leg = { symbol: t.symbol, amount: t.amount, usd: t.usd };
      const row = rows.get(key);
      if (row) {
        row.legs.push(leg);
        row.usd += t.usd;
        continue;
      }
      rows.set(key, {
        direction: t.direction,
        t: t.at.toISOString(),
        walletId: wallet.id,
        chain: wallet.chain,
        network: t.network,
        txHash: t.txHash,
        counterparty: t.counterparty,
        usd: t.usd,
        legs: [leg],
      });
    }
  }

  return [...rows.values()].filter((row) => row.usd >= MIN_USD).sort((a, b) => b.t.localeCompare(a.t));
}
