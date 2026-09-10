"""What the application can fail to do, named so the edge can translate it."""
from __future__ import annotations

from earn.domain.errors import EarnError


class CatalogNotReady(EarnError):
    """Nothing has been fetched yet — a cold start, or upstream was unreachable for it.

    Not the same as "there are no pools", and the difference is the difference
    between 503 and an empty list.
    """


class PoolNotFound(EarnError):
    def __init__(self, pool_id: str) -> None:
        super().__init__(f"no pool with id {pool_id}")
        self.pool_id = pool_id


class CatalogVersionGone(EarnError):
    """A cursor points into a catalog we no longer keep.

    Answered rather than silently restarting from the newest one: that would
    hand the client a page overlapping what it already read, and it would never
    know.
    """


class SelectionMismatch(EarnError):
    """A cursor issued for one set of filters, presented against another."""
