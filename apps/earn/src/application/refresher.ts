import { Logger } from '@nestjs/common';
import { buildCatalog, type Catalog, type ListingPolicy } from '../domain/catalog';
import type { Pool } from '../domain/pool';
import type { CatalogStore } from './store';

export interface YieldSource {
  readonly name: string;
  fetch(): Promise<Pool[]>;
}

export type Clock = () => Date;

export class CatalogRefresher {
  private readonly log = new Logger('CatalogRefresher');
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private firstPass: Promise<void>;
  private passed!: () => void;

  constructor(
    private readonly sources: YieldSource[],
    private readonly store: CatalogStore,
    private readonly policy: ListingPolicy,
    private readonly clock: Clock,
    private readonly intervalMs: number,
  ) {
    this.firstPass = new Promise((resolve) => {
      this.passed = resolve;
    });
  }

  async refreshOnce(): Promise<Catalog | null> {
    const pools: Pool[] = [];
    const failed: string[] = [];

    const results = await Promise.allSettled(this.sources.map((source) => source.fetch()));
    results.forEach((result, index) => {
      const source = this.sources[index];
      if (result.status === 'rejected') {
        failed.push(source.name);
        this.log.warn(`${source.name} could not be read: ${result.reason}`);
        return;
      }
      pools.push(...result.value);
    });

    if (pools.length === 0) {
      const standing = this.store.currentOrNone();
      this.log.warn(
        `refresh produced no pools; ${standing ? `keeping catalog ${standing.version}` : 'nothing to serve yet'}`,
      );
      return standing;
    }

    const catalog = buildCatalog({
      version: this.store.nextVersion(),
      takenAt: this.clock(),
      pools,
      policy: this.policy,
      failedSources: failed,
    });
    this.store.publish(catalog);
    this.log.log(
      `catalog ${catalog.version}: ${catalog.byId.size} pools, ${catalog.listed.length} listed` +
        (failed.length ? `, failed: ${failed.join(', ')}` : ''),
    );
    return catalog;
  }

  start(): void {
    const tick = async () => {
      try {
        await this.refreshOnce();
      } catch (error) {
        this.log.warn(`refresh failed, keeping the previous catalog: ${error}`);
      }
      this.passed();
      if (!this.stopped) this.timer = setTimeout(tick, this.intervalMs);
    };
    void tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  async waitForFirstPass(graceMs: number): Promise<void> {
    if (graceMs <= 0) return;
    await Promise.race([
      this.firstPass,
      new Promise<void>((resolve) => setTimeout(resolve, graceMs)),
    ]);
  }
}
