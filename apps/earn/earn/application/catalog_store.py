"""Where published catalogs live, and how long they stay reachable.

A small ring rather than a single slot, because a cursor points into the
catalog it was issued from: keeping the last few alive is what lets a client
finish paging through a list that has since been rebuilt underneath it.
"""
from __future__ import annotations

from collections import deque

from earn.application.errors import CatalogNotReady
from earn.domain.catalog import Catalog


class CatalogStore:
    """Holds the published catalogs. Not a repository — nothing is persisted."""

    def __init__(self, *, history: int = 3) -> None:
        self._catalogs: deque[Catalog] = deque(maxlen=max(1, history))
        self._next_version = 1

    @property
    def is_ready(self) -> bool:
        return bool(self._catalogs)

    def next_version(self) -> int:
        return self._next_version

    def publish(self, catalog: Catalog) -> None:
        self._catalogs.append(catalog)
        self._next_version = max(self._next_version, catalog.version + 1)

    def current(self) -> Catalog:
        """The newest catalog, or `CatalogNotReady` if there has never been one."""
        if not self._catalogs:
            raise CatalogNotReady
        return self._catalogs[-1]

    def current_or_none(self) -> Catalog | None:
        """For the health endpoint, where "not ready" is an answer and not a failure."""
        return self._catalogs[-1] if self._catalogs else None

    def version(self, version: int) -> Catalog | None:
        return next((c for c in self._catalogs if c.version == version), None)
