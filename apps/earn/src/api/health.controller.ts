import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { Clock } from '../application/refresher';
import { CatalogStore } from '../application/store';
import { ageMs, isStale } from '../domain/catalog';
import type { Settings } from '../settings';
import { CLOCK, SETTINGS } from '../tokens';
import { asOf } from './presenters';

@Controller()
export class HealthController {
  constructor(
    @Inject(CatalogStore) private readonly store: CatalogStore,
    @Inject(SETTINGS) private readonly settings: Settings,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get('health')
  health(@Res() response: Response): void {
    const catalog = this.store.currentOrNone();
    if (catalog === null) {
      response.status(503).json({ status: 'starting', degraded: [] });
      return;
    }
    const now = this.clock();
    response.status(200).json({
      status: 'ok',
      catalog: catalog.version,
      as_of: asOf(catalog.takenAt),
      age_s: Math.round(ageMs(catalog, now) / 1000),
      stale: isStale(catalog, now, this.settings.staleAfterMs),
      pools: catalog.listed.length,
      degraded: catalog.failedSources,
    });
  }
}
