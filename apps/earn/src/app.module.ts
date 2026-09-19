import {
  Inject,
  Module,
  type DynamicModule,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { LendDeposits, type BuildDeposit, type LookUpLanding } from './application/deposits';
import { LendQueries } from './application/queries';
import { CatalogRefresher, type Clock, type YieldSource } from './application/refresher';
import { CatalogStore } from './application/store';
import type { ListingPolicy } from './domain/catalog';
import { buildersWith, landingsWith } from './infrastructure/builders';
import { JsonApi } from './infrastructure/http';
import { KaminoApi } from './infrastructure/kamino/api';
import { KaminoSource } from './infrastructure/kamino/source';
import { HealthController } from './api/health.controller';
import { LendController } from './api/lend.controller';
import { settingsFromEnv, type Settings } from './settings';
import { CLOCK, REFRESHER, SETTINGS, SOURCES } from './tokens';

export interface Built {
  settings?: Settings;
  sources?: YieldSource[];
  clock?: Clock;
  builders?: Record<string, BuildDeposit>;
  landings?: Record<string, LookUpLanding>;
}

@Module({})
export class AppModule implements OnModuleInit, OnApplicationShutdown {
  static with(built: Built = {}): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController, LendController],
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
        ),
      inject: [LendQueries, SETTINGS],
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
