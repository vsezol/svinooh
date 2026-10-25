import { CatalogNotReady } from './errors';
import type { Catalog } from '../domain/catalog';

export class CatalogStore {
  private readonly catalogs: Catalog[] = [];
  private version = 1;

  constructor(private readonly history = 3) {}

  get isReady(): boolean {
    return this.catalogs.length > 0;
  }

  nextVersion(): number {
    return this.version;
  }

  publish(catalog: Catalog): void {
    this.catalogs.push(catalog);
    while (this.catalogs.length > Math.max(1, this.history)) this.catalogs.shift();
    this.version = Math.max(this.version, catalog.version + 1);
  }

  current(): Catalog {
    const standing = this.currentOrNone();
    if (!standing) throw new CatalogNotReady();
    return standing;
  }

  currentOrNone(): Catalog | null {
    return this.catalogs.at(-1) ?? null;
  }

  ofVersion(version: number): Catalog | null {
    return this.catalogs.find((catalog) => catalog.version === version) ?? null;
  }
}
