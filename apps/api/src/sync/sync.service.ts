import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Wallet } from '@prisma/client';
import type { Chain } from '@svinooh/shared';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { scanAddress } from '../scanners';
import { closeBrowser } from '../scanners/browser';
import type { ScanResult } from '../scanners/types';
import { scanQueue } from './scan-queue';

@Injectable()
export class SyncService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private cycleRunning = false;
  /** `${chain}:${address}` сканов в полёте — чтобы цикл и «скан при добавлении» не дублировались */
  private readonly inFlight = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    const intervalMs = config.syncIntervalMin * 60_000;
    this.timer = setInterval(() => void this.runCycle(), intervalMs);
    this.timer.unref?.();
    // Первый прогон вскоре после старта — подхватывает кошельки, застрявшие
    // в pending после рестарта
    setTimeout(() => void this.runCycle(), 10_000).unref?.();
    this.logger.log(`Background wallet sync every ${config.syncIntervalMin} min`);
  }

  async onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    await closeBrowser();
  }

  /** Немедленный скан только что добавленного кошелька */
  async scanWalletNow(walletId: string): Promise<void> {
    const wallet = await this.prisma.wallet.findUnique({ where: { id: walletId } });
    if (!wallet) return;
    await this.scanGroup(wallet.chain as Chain, wallet.address, [wallet]);
    await this.snapshotPortfolio(wallet.portfolioId);
  }

  async runCycle(): Promise<void> {
    if (this.cycleRunning) return;
    this.cycleRunning = true;
    const startedAt = Date.now();
    try {
      const wallets = await this.prisma.wallet.findMany();
      if (!wallets.length) return;

      // Один адрес может лежать в нескольких портфелях — сканируем один раз
      const groups = new Map<string, Wallet[]>();
      for (const wallet of wallets) {
        const key = `${wallet.chain}:${wallet.address}`;
        const group = groups.get(key) ?? [];
        group.push(wallet);
        groups.set(key, group);
      }

      await Promise.allSettled(
        [...groups.values()].map((group) =>
          this.scanGroup(group[0].chain as Chain, group[0].address, group),
        ),
      );

      const portfolioIds = [...new Set(wallets.map((w) => w.portfolioId))];
      for (const portfolioId of portfolioIds) await this.snapshotPortfolio(portfolioId);

      this.logger.log(
        `Cycle: ${groups.size} addresses in ${Math.round((Date.now() - startedAt) / 1000)}s`,
      );
    } catch (error) {
      this.logger.error(`Sync cycle failed: ${error}`);
    } finally {
      this.cycleRunning = false;
    }
  }

  private async scanGroup(chain: Chain, address: string, group: Wallet[]): Promise<void> {
    const key = `${chain}:${address}`;
    if (this.inFlight.has(key)) return;
    this.inFlight.add(key);
    try {
      const previousTotal = group.map((w) => w.lastTotalUsd).find((v) => v !== null) ?? null;
      const result = await this.scanWithSanityCheck(chain, address, previousTotal);
      await this.applyResult(group, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Scan ${key} failed: ${message}`);
      await this.markFailed(group, message);
    } finally {
      this.inFlight.delete(key);
    }
  }

  /**
   * Тихо неверная цифра хуже упавшего запроса. Резкое падение почти до нуля
   * чаще означает сбой источника (задушенный Chrome, недоступный API), а не
   * опустевший кошелёк — поэтому перепроверяем вторым сканом. Сходятся два
   * независимых замера — принимаем (кошелёк правда опустел); расходятся —
   * прогон помечается failed и история НЕ пишется, кэш остаётся со stale.
   */
  private async scanWithSanityCheck(
    chain: Chain,
    address: string,
    previousTotal: number | null,
  ): Promise<ScanResult> {
    const first = await scanQueue.run(chain, () => scanAddress(chain, address));
    const suspicious =
      previousTotal !== null && previousTotal > 10 && first.totalUsd < previousTotal * 0.05;
    if (!suspicious) return first;

    this.logger.warn(
      `Suspicious drop ${chain}:${address}: $${previousTotal.toFixed(2)} → $${first.totalUsd.toFixed(2)}, re-checking`,
    );
    const second = await scanQueue.run(chain, () => scanAddress(chain, address));
    if (second.totalUsd >= previousTotal * 0.05) return second; // первый замер был глюком
    const agree =
      Math.abs(first.totalUsd - second.totalUsd) <=
      Math.max(1, 0.2 * Math.max(first.totalUsd, second.totalUsd));
    if (agree) return second;
    throw new Error(
      `Suspicious result: was $${previousTotal.toFixed(2)}, measurements gave $${first.totalUsd.toFixed(2)} and $${second.totalUsd.toFixed(2)}`,
    );
  }

  private async applyResult(group: Wallet[], result: ScanResult): Promise<void> {
    const now = new Date();
    for (const wallet of group) {
      await this.prisma.$transaction([
        this.prisma.position.deleteMany({ where: { walletId: wallet.id } }),
        this.prisma.position.createMany({
          data: result.positions.map((p) => ({
            walletId: wallet.id,
            symbol: p.symbol.slice(0, 120),
            name: p.name?.slice(0, 200) ?? null,
            amount: p.amount ?? null,
            priceUsd: p.priceUsd ?? null,
            valueUsd: p.valueUsd,
            platform: p.platform ?? null,
            category: p.category,
          })),
        }),
        this.prisma.wallet.update({
          where: { id: wallet.id },
          data: {
            status: 'ok',
            lastTotalUsd: result.totalUsd,
            lastSyncedAt: now,
            lastError: null,
            breakdown: result.breakdown ?? {},
            unpriced: result.unpriced ?? [],
          },
        }),
        this.prisma.walletSnapshot.create({
          data: { walletId: wallet.id, totalUsd: result.totalUsd, breakdown: result.breakdown },
        }),
      ]);
    }
  }

  /** Кэш последнего успешного значения сознательно не трогаем — он отдаётся со stale-флагом */
  private async markFailed(group: Wallet[], message: string): Promise<void> {
    await this.prisma.wallet.updateMany({
      where: { id: { in: group.map((w) => w.id) } },
      data: { status: 'failed', lastError: message.slice(0, 500) },
    });
  }

  async snapshotPortfolio(portfolioId: string): Promise<void> {
    const wallets = await this.prisma.wallet.findMany({ where: { portfolioId } });
    if (!wallets.length) {
      // последний кошелёк удалён — фиксируем ноль, чтобы график это отразил
      await this.prisma.portfolioSnapshot.create({ data: { portfolioId, totalUsd: 0 } });
      return;
    }
    const known = wallets.filter((w) => w.lastTotalUsd !== null);
    if (!known.length) return; // ещё ничего не сосканировано
    const totalUsd = known.reduce((sum, w) => sum + (w.lastTotalUsd ?? 0), 0);
    await this.prisma.portfolioSnapshot.create({ data: { portfolioId, totalUsd } });
  }
}
