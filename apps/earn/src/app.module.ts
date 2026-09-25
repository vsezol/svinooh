import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { LendCoins, type FindCoin } from './application/coins';
import {
  LendLiquidity,
  type LiquidityBuilders,
  type ReadLiquidityPositions,
  type ReadPairPool,
  type ReadPairPools,
} from './application/liquidity';
import {
  LendDeposits,
  type BuildDeposit,
  type LookUpLanding,
  type ReadEffects,
  type ReadHoldings,
} from './application/deposits';
import {
  LendMoves,
  type BuildMove,
  type BuildTakeOut,
  type BuildWithdrawal,
  type ReadPositions,
} from './application/moves';
import { LendQueries } from './application/queries';
import { CatalogRefresher, type Clock, type YieldSource } from './application/refresher';
import { CatalogStore } from './application/store';
import type { ListingPolicy } from './domain/catalog';
import {
  buildersWith,
  coinsWith,
  effectsWith,
  holdingsWith,
  liquidityPositionsWith,
  liquidityWith,
  pairPoolsWith,
  pairPoolWith,
  landingsWith,
  movesWith,
  positionsWith,
  takeOutsWith,
  withdrawalsWith,
} from './infrastructure/builders';
import { JsonApi } from './infrastructure/http';
import { KaminoApi } from './infrastructure/kamino/api';
import { KaminoSource } from './infrastructure/kamino/source';
import { HealthController } from './api/health.controller';
import { LendController } from './api/lend.controller';
import { LiquidityController } from './api/liquidity.controller';
import { settingsFromEnv, type Settings } from './settings';
import { CLOCK, REFRESHER, SETTINGS, SOURCES } from './tokens';

export interface Built {
  settings?: Settings;
  sources?: YieldSource[];
  clock?: Clock;
  builders?: Record<string, BuildDeposit>;
  landings?: Record<string, LookUpLanding>;
  effects?: Record<string, ReadEffects>;
  holdings?: Record<string, ReadHoldings>;
  positions?: Record<string, ReadPositions>;
  withdrawals?: Record<string, BuildWithdrawal>;
  moves?: Record<string, BuildMove>;
  takeOuts?: Record<string, BuildTakeOut>;
  coins?: Record<string, FindCoin>;
  pairPools?: Record<string, ReadPairPools>;
  pairPool?: Record<string, ReadPairPool>;
  liquidityPositions?: Record<string, ReadLiquidityPositions>;
  liquidity?: Record<string, LiquidityBuilders>;
}

@Module({})
export class AppModule implements OnModuleInit, OnApplicationShutdown {
  static with(built: Built = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, LendController, LiquidityController],
      providers: providersFor(built),
    };
  }

  constructor(
    @Inject(REFRESHER) private readonly refresher: CatalogRefresher,
    @Inject(SETTINGS) private readonly settings: Settings,
  ) {}

  async onModuleInit(): Promise<void> {
    this.refresher.start();
    await this.refresher.waitForFirstPass(this.settings.startupGraceMs);
  }

  onApplicationShutdown(): void {
    this.refresher.stop();
  }
}

function providersFor(built: Built) {
  return [
    { provide: SETTINGS, useFactory: () => built.settings ?? settingsFromEnv() },
    { provide: CLOCK, useFactory: () => built.clock ?? (() => new Date()) },
    {
      provide: CatalogStore,
      useFactory: (settings: Settings) => new CatalogStore(settings.catalogHistory),
      inject: [SETTINGS],
    },
    {
      provide: LendQueries,
      useFactory: (store: CatalogStore) => new LendQueries(store),
      inject: [CatalogStore],
    },
    {
      provide: LendDeposits,
      useFactory: (queries: LendQueries, settings: Settings) =>
        new LendDeposits(
          queries,
          built.builders ?? buildersWith(settings.solanaRpcUrl),
          built.landings ?? landingsWith(settings.solanaRpcUrl),
          built.holdings ?? holdingsWith(settings.solanaRpcUrl),
          built.effects ?? effectsWith(settings.solanaRpcUrl),
        ),
      inject: [LendQueries, SETTINGS],
    },
    {
      provide: LendCoins,
      useFactory: (queries: LendQueries, settings: Settings) =>
        new LendCoins(
          queries,
          built.coins ?? coinsWith(settings.solanaRpcUrl),
          built.holdings ?? holdingsWith(settings.solanaRpcUrl),
        ),
      inject: [LendQueries, SETTINGS],
    },
    {
      provide: LendMoves,
      useFactory: (queries: LendQueries, coins: LendCoins, settings: Settings) =>
        new LendMoves(
          queries,
          built.positions ?? positionsWith(settings.solanaRpcUrl),
          built.withdrawals ?? withdrawalsWith(settings.solanaRpcUrl),
          built.moves ?? movesWith(settings.solanaRpcUrl),
          coins,
          built.holdings ?? holdingsWith(settings.solanaRpcUrl),
          built.takeOuts ?? takeOutsWith(settings.solanaRpcUrl),
        ),
      inject: [LendQueries, LendCoins, SETTINGS],
    },
    {
      provide: LendLiquidity,
      useFactory: (settings: Settings, moves: LendMoves) =>
        new LendLiquidity(
          built.pairPools ?? pairPoolsWith(),
          built.pairPool ?? pairPoolWith(),
          built.liquidityPositions ?? liquidityPositionsWith(),
          settings.minTvlUsd,
          built.liquidity ?? liquidityWith(settings.solanaRpcUrl),
          built.holdings ?? holdingsWith(settings.solanaRpcUrl),
          moves,
        ),
      inject: [SETTINGS, LendMoves],
    },
    {
      provide: SOURCES,
      useFactory: (settings: Settings): YieldSource[] =>
        built.sources ?? [
          new KaminoSource(
            new KaminoApi(
              new JsonApi(settings.kaminoApi, settings.httpTimeoutMs, settings.httpConcurrency),
            ),
            settings.includeReserves,
          ),
        ],
      inject: [SETTINGS],
    },
    {
      provide: REFRESHER,
      useFactory: (
        settings: Settings,
        store: CatalogStore,
        sources: YieldSource[],
        clock: Clock,
      ) => {
        const policy: ListingPolicy = {
          minTvl: settings.minTvlUsd,
          excludedNameMarks: settings.excludedNameMarks,
        };
        return new CatalogRefresher(sources, store, policy, clock, settings.refreshIntervalMs);
      },
      inject: [SETTINGS, CatalogStore, SOURCES, CLOCK],
    },
  ];
}
