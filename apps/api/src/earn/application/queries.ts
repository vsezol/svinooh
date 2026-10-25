import type { Catalog } from '../domain/catalog';
import { find } from '../domain/catalog';
import type { Pool } from '../domain/pool';
import {
  apply,
  fingerprint,
  matches,
  paginate,
  type Page,
  type PoolFilter,
  type PoolSelection,
} from '../domain/selection';
import { tokenYields, type TokenYield } from '../domain/tokens';
import { parseId } from '../domain/values';
import { CatalogVersionGone, PoolNotFound, SelectionMismatch } from './errors';
import type { CatalogStore } from './store';

export interface Resume {
  catalogVersion: number;
  offset: number;
  fingerprint: string;
}

export interface PoolsAnswer {
  page: Page;
  resume: Resume | null;
  catalog: Catalog;
}

export interface PoolAnswer {
  pool: Pool;
  catalog: Catalog;
}

export interface NetworkAnswer {
  pools: Pool[];
  catalog: Catalog;
}

export interface TokensAnswer {
  tokens: TokenYield[];
  catalog: Catalog;
}

export class LendQueries {
  constructor(private readonly store: CatalogStore) {}

  listPools(selection: PoolSelection, limit: number, resume: Resume | null = null): PoolsAnswer {
    let catalog = this.store.current();
    let offset = 0;

    if (resume !== null) {
      if (resume.fingerprint !== fingerprint(selection)) throw new SelectionMismatch();
      const older = this.store.ofVersion(resume.catalogVersion);
      if (older === null) throw new CatalogVersionGone();
      catalog = older;
      offset = resume.offset;
    }

    const page = paginate(apply(selection, catalog.listed), offset, limit);
    return {
      page,
      resume:
        page.nextOffset !== null
          ? {
              catalogVersion: catalog.version,
              offset: page.nextOffset,
              fingerprint: fingerprint(selection),
            }
          : null,
      catalog,
    };
  }

  getPool(rawId: string): PoolAnswer {
    const catalog = this.store.current();
    const id = parseId(rawId);
    const found = id !== null ? find(catalog, id) : null;
    if (found === null) throw new PoolNotFound(rawId);
    return { pool: found, catalog };
  }

  /**
   * Every pool on a network, listed or not: somebody can hold money in a pool
   * the listing policy has since hidden, and it is still theirs to take out.
   */
  onNetwork(network: string): NetworkAnswer {
    const catalog = this.store.current();
    const pools = [...catalog.byId.values()].filter((pool) => pool.id.network === network);
    return { pools, catalog };
  }

  listTokens(filter: PoolFilter): TokensAnswer {
    const catalog = this.store.current();
    const matching = catalog.listed.filter((pool) => matches(filter, pool));
    return { tokens: tokenYields(matching), catalog };
  }
}
