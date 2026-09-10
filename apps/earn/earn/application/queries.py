"""The questions this service answers.

Three, and each returns the catalog it was answered from — because a rate
without the moment it was read is not a fact, and the edge needs that moment to
put in `meta`.

These are use cases, not a repository wrapper: they hold the rules about
resuming a page and about what "not found" means, and they are the only thing
the api layer is allowed to call.
"""
from __future__ import annotations

from dataclasses import dataclass

from earn.application.catalog_store import CatalogStore
from earn.application.errors import CatalogVersionGone, PoolNotFound, SelectionMismatch
from earn.domain.catalog import Catalog
from earn.domain.pool import Pool
from earn.domain.selection import Page, PoolFilter, PoolSelection, paginate
from earn.domain.tokens import TokenYield, token_yields
from earn.domain.values import PoolId


@dataclass(frozen=True, slots=True)
class Resume:
    """Where a client got to, and in which list.

    What a cursor carries, without knowing how a cursor is written down.
    """

    catalog_version: int
    offset: int
    fingerprint: str


@dataclass(frozen=True, slots=True)
class PoolsAnswer:
    page: Page
    #: What the next cursor must carry, or None at the end of the list.
    resume: Resume | None
    catalog: Catalog


@dataclass(frozen=True, slots=True)
class PoolAnswer:
    pool: Pool
    catalog: Catalog


@dataclass(frozen=True, slots=True)
class TokensAnswer:
    tokens: tuple[TokenYield, ...]
    catalog: Catalog


class LendQueries:
    def __init__(self, store: CatalogStore) -> None:
        self._store = store

    def list_pools(
        self, selection: PoolSelection, *, limit: int, resume: Resume | None = None
    ) -> PoolsAnswer:
        """One page of pools, from the catalog this cursor belongs to."""
        catalog = self._store.current()
        offset = 0

        if resume is not None:
            if resume.fingerprint != selection.fingerprint():
                raise SelectionMismatch
            older = self._store.version(resume.catalog_version)
            if older is None:
                raise CatalogVersionGone
            catalog, offset = older, resume.offset

        page = paginate(selection.apply(catalog.listed), offset=offset, limit=limit)
        return PoolsAnswer(
            page=page,
            resume=(
                Resume(catalog.version, page.next_offset, selection.fingerprint())
                if page.next_offset is not None
                else None
            ),
            catalog=catalog,
        )

    def get_pool(self, raw_id: str) -> PoolAnswer:
        """One pool, listed or not.

        Every pool is addressable, not only the listed ones: somebody may hold
        shares in one that sits below the listing floor, and answering "no such
        pool" for one that exists would be a lie about the chain.
        """
        catalog = self._store.current()
        pool_id = PoolId.parse(raw_id)
        found = catalog.find(pool_id) if pool_id is not None else None
        if found is None:
            raise PoolNotFound(raw_id)
        return PoolAnswer(pool=found, catalog=catalog)

    def list_tokens(self, pool_filter: PoolFilter) -> TokensAnswer:
        """What is earnable, one row per token.

        The agent's first question is almost never "list every pool" — it is
        "what can I do with my USDC". Answering that from the pool list means
        fetching hundreds of rows to reduce them to a dozen on every turn, so
        the reduction happens here.
        """
        catalog = self._store.current()
        matching = [pool for pool in catalog.listed if pool_filter.matches(pool)]
        return TokensAnswer(tokens=token_yields(matching), catalog=catalog)
