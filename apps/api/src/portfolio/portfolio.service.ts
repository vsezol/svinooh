import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Portfolio, Position, Wallet } from '@prisma/client';
import type {
  Chain,
  HistoryDto,
  HistoryPointDto,
  HistoryRange,
  PortfolioDto,
  PositionCategory,
  PublicPortfolioDto,
  WalletDto,
  WalletSyncStatus,
} from '@svinooh/shared';
import { round2 } from '../common/util';
import { config } from '../config';
import { PrismaService } from '../prisma.service';
import { detectChain } from '../scanners';
import { SyncService } from '../sync/sync.service';

type WalletWithPositions = Wallet & { positions: Position[] };

const RANGES: Record<HistoryRange, { sinceMs: number | null; bucket: string | null }> = {
  '24h': { sinceMs: 24 * 3600e3, bucket: null }, // сырые 5-минутные точки
  '7d': { sinceMs: 7 * 86400e3, bucket: '30 minutes' },
  '30d': { sinceMs: 30 * 86400e3, bucket: '2 hours' },
  all: { sinceMs: null, bucket: '6 hours' },
};

export function normalizeRange(raw: string | undefined): HistoryRange {
  return raw === '7d' || raw === '30d' || raw === 'all' ? raw : '24h';
}

/**
 * Убирает провалы стоимости кошелька, которые сами восстанавливаются — это
 * почти всегда глюк источника (TronGrid без стейка, Chrome-скрейп с $0), а не
 * реальное движение. Просадку глубже 10% считаем кандидатом; если в пределах
 * окна значение возвращается почти точно к прежнему (98%+) — это выброс,
 * держим последнее хорошее значение (график не «пилит»). Реальное движение так
 * точно назад не отскакивает и проходит как есть.
 */
function smoothSeries(
  series: Array<{ t: number; v: number }>,
): Array<{ t: number; v: number }> {
  // Отличаем глюк от реального движения не по глубине, а по возврату: цена
  // проваливается и возвращается почти точно к прежнему значению (данные по
  // кошельку восстановились, реально ничего не менялось). Настоящее движение
  // так точно назад не отскакивает.
  const DROP = 0.9; // просадка глубже 10% — кандидат в выброс
  const RECOVER = 0.98; // если вернулось к 98%+ прежнего — это был выброс
  const WINDOW = 90; // как далеко вперёд ищем восстановление (~1.5ч при 1-мин синке)
  const out = series.map((s) => ({ t: s.t, v: s.v }));
  let lastGood = series[0].v;
  for (let i = 0; i < out.length; i++) {
    const cur = series[i].v;
    if (lastGood > 10 && cur < lastGood * DROP) {
      let recovers = false;
      const end = Math.min(series.length - 1, i + WINDOW);
      for (let j = i + 1; j <= end; j++) {
        if (series[j].v >= lastGood * RECOVER) {
          recovers = true;
          break;
        }
      }
      if (recovers) {
        out[i].v = lastGood; // спурьёзный провал — держим прошлое значение
        continue;
      }
    }
    out[i].v = cur;
    lastGood = cur;
  }
  return out;
}

/** Прореживание ряда до max точек (всегда сохраняя последнюю) */
function downsample(points: HistoryPointDto[], max: number): HistoryPointDto[] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const out: HistoryPointDto[] = [];
  for (let i = 0; i < points.length; i += step) out.push(points[i]);
  const last = points[points.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

@Injectable()
export class PortfolioService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SyncService,
  ) {}

  /**
   * Лидерборд/поиск для лендинга: публичные портфели по убыванию стоимости.
   * Портфели и так открыты по ссылке — тут они просто перечислены.
   */
  async listPublic(limit: number, query: string): Promise<PublicPortfolioDto[]> {
    const portfolios = await this.prisma.portfolio.findMany({
      include: { user: true, wallets: true },
    });

    const q = query.trim().toLowerCase().replace(/^@/, '');
    const rows = portfolios
      .map((portfolio) => {
        const known = portfolio.wallets.filter((w) => w.lastTotalUsd !== null);
        const totalUsd = round2(known.reduce((sum, w) => sum + (w.lastTotalUsd ?? 0), 0));
        const chains = [...new Set(portfolio.wallets.map((w) => w.chain as Chain))];
        const handle =
          portfolio.user.username ||
          [portfolio.user.firstName, portfolio.user.lastName].filter(Boolean).join(' ') ||
          'anon';
        return {
          slug: portfolio.slug,
          name: portfolio.name,
          handle,
          photoUrl: portfolio.user.photoUrl,
          totalUsd,
          walletCount: portfolio.wallets.length,
          chains,
        };
      })
      .filter((p) => p.walletCount > 0)
      .filter((p) => !q || p.handle.toLowerCase().includes(q) || p.name.toLowerCase().includes(q) || p.slug.includes(q))
      .sort((a, b) => b.totalUsd - a.totalUsd)
      .slice(0, Math.min(Math.max(limit, 1), 100));

    return rows;
  }

  /** Публичный просмотр: портфель по ссылке виден без входа */
  async getBySlug(slug: string, userId: string | null): Promise<PortfolioDto> {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      include: { user: true, wallets: { include: { positions: true } } },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');

    const staleBefore = Date.now() - 3 * config.syncIntervalMin * 60_000;
    const wallets = portfolio.wallets
      .map((wallet) => this.toWalletDto(wallet, staleBefore))
      .sort(walletOrder);

    const updatedAt = wallets.reduce<string | null>(
      (latest, w) => (w.lastSyncedAt && (!latest || w.lastSyncedAt > latest) ? w.lastSyncedAt : latest),
      null,
    );

    const owner = portfolio.user;
    return {
      slug: portfolio.slug,
      name: portfolio.name,
      owner: {
        name:
          [owner.firstName, owner.lastName].filter(Boolean).join(' ') || owner.username || 'Аноним',
        username: owner.username,
        photoUrl: owner.photoUrl,
      },
      totalUsd: round2(wallets.reduce((sum, w) => sum + (w.totalUsd ?? 0), 0)),
      wallets,
      isOwner: userId !== null && portfolio.userId === userId,
      updatedAt,
      createdAt: portfolio.createdAt.toISOString(),
    };
  }

  async rename(slug: string, userId: string, nameRaw: string): Promise<{ name: string }> {
    const portfolio = await this.requireOwned(slug, userId);
    const name = String(nameRaw || '').trim().slice(0, 64);
    if (!name) throw new BadRequestException('Empty name');
    await this.prisma.portfolio.update({ where: { id: portfolio.id }, data: { name } });
    return { name };
  }

  async addWallet(slug: string, userId: string, addressRaw: string): Promise<WalletDto> {
    const portfolio = await this.requireOwned(slug, userId);
    const address = String(addressRaw || '').trim();
    if (!address) throw new BadRequestException('Empty address');

    const chain = detectChain(address);
    if (!chain) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'UNSUPPORTED_NETWORK',
        message: 'Could not detect the address network. Supported: BTC, EVM (0x…), SOL and TRON.',
      });
    }

    const existing = await this.prisma.wallet.findUnique({
      where: { portfolioId_address: { portfolioId: portfolio.id, address } },
    });
    if (existing) {
      throw new ConflictException({
        statusCode: 409,
        code: 'WALLET_EXISTS',
        message: 'This wallet is already in the portfolio',
      });
    }

    const wallet = await this.prisma.wallet.create({
      data: { portfolioId: portfolio.id, address, chain },
    });
    // Скан асинхронный: ручка отвечает сразу (status=pending), фронт поллит.
    // EVM-скан занимает 20–40 секунд — держать HTTP-запрос столько нельзя.
    void this.sync.scanWalletNow(wallet.id).catch(() => {});
    return this.toWalletDto({ ...wallet, positions: [] }, 0);
  }

  async renameWallet(
    slug: string,
    userId: string,
    walletId: string,
    labelRaw: string,
  ): Promise<{ label: string | null }> {
    const portfolio = await this.requireOwned(slug, userId);
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, portfolioId: portfolio.id },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    // Пустое имя — сброс к дефолту (null)
    const label = String(labelRaw || '').trim().slice(0, 40) || null;
    await this.prisma.wallet.update({ where: { id: wallet.id }, data: { label } });
    return { label };
  }

  async removeWallet(slug: string, userId: string, walletId: string): Promise<{ ok: true }> {
    const portfolio = await this.requireOwned(slug, userId);
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, portfolioId: portfolio.id },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    await this.prisma.wallet.delete({ where: { id: wallet.id } });
    await this.sync.snapshotPortfolio(portfolio.id);
    return { ok: true };
  }

  async history(slug: string, range: HistoryRange): Promise<HistoryDto> {
    const portfolio = await this.prisma.portfolio.findUnique({
      where: { slug },
      include: { wallets: { select: { id: true } } },
    });
    if (!portfolio) throw new NotFoundException('Portfolio not found');
    const points = await this.reconstructPortfolioSeries(
      portfolio.wallets.map((w) => w.id),
      range,
    );
    return { range, points };
  }

  /**
   * Ряд стоимости портфеля без «скачков» от добавления кошельков: собираем из
   * снапшотов кошельков, где стоимость каждого кошелька перенесена (carry-back)
   * его самым ранним известным значением на весь диапазон. Поэтому добавление
   * кошелька не выглядит как прибыль: change = Σ(текущая) − Σ(стартовая) =
   * сумма реальной прибыли по кошелькам, а change% = Σприбыль / Σстартовая.
   */
  private async reconstructPortfolioSeries(
    walletIds: string[],
    range: HistoryRange,
  ): Promise<HistoryPointDto[]> {
    if (!walletIds.length) return [];
    const { sinceMs } = RANGES[range];
    const since = sinceMs ? new Date(Date.now() - sinceMs) : null;
    const snaps = await this.prisma.walletSnapshot.findMany({
      where: { walletId: { in: walletIds }, ...(since ? { createdAt: { gte: since } } : {}) },
      orderBy: { createdAt: 'asc' },
      select: { walletId: true, createdAt: true, totalUsd: true },
    });
    if (!snaps.length) return [];

    // группируем снапшоты по кошельку (уже отсортированы по времени) и сглаживаем
    // каждый — убирая кратковременные провалы-глюки, которые сами восстанавливаются
    const byWallet = new Map<string, Array<{ t: number; v: number }>>();
    for (const s of snaps) {
      const arr = byWallet.get(s.walletId) ?? [];
      arr.push({ t: s.createdAt.getTime(), v: s.totalUsd });
      byWallet.set(s.walletId, arr);
    }

    // старт каждого кошелька (carry-back) — первое сглаженное значение в диапазоне
    const baseline = new Map<string, number>();
    const events: Array<{ t: number; id: string; v: number }> = [];
    for (const [id, series] of byWallet) {
      const smooth = smoothSeries(series);
      baseline.set(id, smooth[0].v);
      for (const p of smooth) events.push({ t: p.t, id, v: p.v });
    }

    // кошельки без снапшота в диапазоне (весь период не синхронизировались) —
    // берём их последнее известное значение до начала диапазона, чтобы итог
    // включал все кошельки, а линия не занижалась
    if (since) {
      const missing = walletIds.filter((id) => !baseline.has(id));
      if (missing.length) {
        const prior = await this.prisma.walletSnapshot.findMany({
          where: { walletId: { in: missing }, createdAt: { lt: since } },
          orderBy: { createdAt: 'desc' },
          select: { walletId: true, totalUsd: true },
        });
        for (const p of prior) if (!baseline.has(p.walletId)) baseline.set(p.walletId, p.totalUsd);
      }
    }

    // идём по событиям во времени, сумма = Σ последних известных значений
    // (изначально = стартовые, поэтому «новый» кошелёк присутствует с t0)
    events.sort((a, b) => a.t - b.t);
    const current = new Map<string, number>(baseline);
    const points: HistoryPointDto[] = [];
    for (const e of events) {
      current.set(e.id, e.v);
      let sum = 0;
      for (const v of current.values()) sum += v;
      points.push({ t: new Date(e.t).toISOString(), usd: round2(sum) });
    }
    return downsample(points, 220);
  }

  async walletHistory(slug: string, walletId: string, range: HistoryRange): Promise<HistoryDto> {
    const wallet = await this.prisma.wallet.findFirst({
      where: { id: walletId, portfolio: { slug } },
    });
    if (!wallet) throw new NotFoundException('Wallet not found');
    const points = await this.series('WalletSnapshot', 'walletId', wallet.id, range);
    return { range, points };
  }

  private async requireOwned(slug: string, userId: string): Promise<Portfolio> {
    const portfolio = await this.prisma.portfolio.findUnique({ where: { slug } });
    if (!portfolio) throw new NotFoundException('Portfolio not found');
    if (portfolio.userId !== userId) throw new ForbiddenException("This isn't your portfolio");
    return portfolio;
  }

  /**
   * Ряды для графиков. 24h — сырые точки (шаг = интервалу синка), длинные
   * диапазоны агрегируются в бакеты date_bin на стороне Postgres.
   */
  private async series(
    table: 'PortfolioSnapshot' | 'WalletSnapshot',
    fkColumn: 'portfolioId' | 'walletId',
    id: string,
    range: HistoryRange,
  ): Promise<HistoryPointDto[]> {
    const { sinceMs, bucket } = RANGES[range];
    const since = sinceMs ? new Date(Date.now() - sinceMs) : null;

    if (!bucket) {
      const where = { [fkColumn]: id, ...(since ? { createdAt: { gte: since } } : {}) };
      const rows =
        table === 'PortfolioSnapshot'
          ? await this.prisma.portfolioSnapshot.findMany({
              where: where as Prisma.PortfolioSnapshotWhereInput,
              orderBy: { createdAt: 'asc' },
              select: { createdAt: true, totalUsd: true },
            })
          : await this.prisma.walletSnapshot.findMany({
              where: where as Prisma.WalletSnapshotWhereInput,
              orderBy: { createdAt: 'asc' },
              select: { createdAt: true, totalUsd: true },
            });
      return rows.map((row) => ({ t: row.createdAt.toISOString(), usd: round2(row.totalUsd) }));
    }

    const rows = await this.prisma.$queryRaw<Array<{ bucket: Date; usd: number }>>(Prisma.sql`
      SELECT date_bin(${bucket}::interval, "createdAt", TIMESTAMP '2020-01-01') AS bucket,
             AVG("totalUsd")::float8 AS usd
      FROM ${Prisma.raw(`"${table}"`)}
      WHERE ${Prisma.raw(`"${fkColumn}"`)} = ${id}
        ${since ? Prisma.sql`AND "createdAt" >= ${since}` : Prisma.empty}
      GROUP BY bucket
      ORDER BY bucket ASC
    `);
    return rows.map((row) => ({ t: row.bucket.toISOString(), usd: round2(Number(row.usd)) }));
  }

  private toWalletDto(wallet: WalletWithPositions, staleBefore: number): WalletDto {
    const positions = [...wallet.positions]
      .sort((a, b) => b.valueUsd - a.valueUsd)
      .map((p) => ({
        id: p.id,
        symbol: p.symbol,
        name: p.name,
        amount: p.amount,
        priceUsd: p.priceUsd,
        valueUsd: round2(p.valueUsd),
        platform: p.platform,
        category: p.category as PositionCategory,
      }));

    return {
      id: wallet.id,
      address: wallet.address,
      chain: wallet.chain as Chain,
      label: wallet.label,
      totalUsd: wallet.lastTotalUsd === null ? null : round2(wallet.lastTotalUsd),
      status: wallet.status as WalletSyncStatus,
      stale:
        wallet.status !== 'pending' &&
        (wallet.lastSyncedAt === null || wallet.lastSyncedAt.getTime() < staleBefore),
      lastSyncedAt: wallet.lastSyncedAt?.toISOString() ?? null,
      lastError: wallet.lastError,
      breakdown: (wallet.breakdown as Record<string, number> | null) ?? null,
      positions,
      unpriced: (wallet.unpriced as string[] | null) ?? undefined,
      createdAt: wallet.createdAt.toISOString(),
    };
  }
}

/** Кошельки — по убыванию стоимости; ещё не сосканированные — в конец */
function walletOrder(a: WalletDto, b: WalletDto): number {
  if (a.totalUsd === null && b.totalUsd === null) return a.createdAt < b.createdAt ? -1 : 1;
  if (a.totalUsd === null) return 1;
  if (b.totalUsd === null) return -1;
  return b.totalUsd - a.totalUsd;
}
