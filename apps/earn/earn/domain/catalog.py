"""A catalog: every pool as of one moment, and the rule for what to show.

Immutable by construction. A request is answered from a catalog rather than
from a live upstream, which is what makes paging mean something — page two is
computed from exactly the list page one came from — and what lets an answer
say honestly how old it is.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from earn.domain.pool import Pool
from earn.domain.values import PoolId, Usd


@dataclass(frozen=True, slots=True)
class ListingPolicy:
    """What counts as a pool worth showing somebody.

    This is a judgement, not a fact, which is exactly why it is a named object
    with its numbers passed in rather than an `if` buried in a mapper. Kamino's
    API returns every vault ever created — 178 against the ~30 its own UI shows
    — and offers no visibility flag to go by, so somebody has to decide, and it
    should be legible who and on what grounds.
    """

    #: Below this a pool is noise. Not arbitrary: a reserve holding $11k was
    #: showing 165% APY and therefore ranking first for "where can I earn
    #: USDC". The rate was real — a nearly-empty reserve at full utilisation —
    #: and the recommendation was still nonsense, because nobody can put money
    #: in at that rate. A floor is the cheapest defence against a true number
    #: that means nothing.
    min_tvl: Usd
    #: Substrings that mark a pool as not meant for anybody, matched
    #: case-insensitively against its name.
    excluded_name_marks: tuple[str, ...] = ()

    def permits(self, pool: Pool) -> bool:
        if pool.tvl_usd < self.min_tvl:
            return False
        # A pool paying nothing is a real account you can really deposit into —
        # a collateral-only reserve with borrowing switched off — and is not an
        # answer to "where can I earn".
        if not pool.apy.net.is_positive():
            return False
        name = pool.name.lower()
        return not any(mark in name for mark in self.excluded_name_marks)


@dataclass(frozen=True, slots=True)
class Catalog:
    """Every pool as of one moment. Never mutated once built."""

    #: Monotonic within a process. A cursor names it, so two responses carrying
    #: the same version are consistent with each other.
    version: int
    taken_at: datetime
    #: The pools worth listing, in no particular order — ordering is per query.
    listed: tuple[Pool, ...]
    #: Every pool, listed or not, by id. A pool below the listing floor is
    #: still one somebody may hold shares in, and answering "no such pool" for
    #: one that exists would be a lie about the chain.
    by_id: dict[str, Pool] = field(default_factory=dict)
    #: Sources that could not be read at all when this was built. Non-empty
    #: means the catalog is incomplete, which is a different problem from old.
    failed_sources: tuple[str, ...] = ()

    @classmethod
    def build(
        cls,
        *,
        version: int,
        taken_at: datetime,
        pools: Iterable[Pool],
        policy: ListingPolicy,
        failed_sources: tuple[str, ...] = (),
    ) -> Catalog:
        materialised = tuple(pools)
        return cls(
            version=version,
            taken_at=taken_at,
            listed=tuple(pool for pool in materialised if policy.permits(pool)),
            by_id={str(pool.id): pool for pool in materialised},
            failed_sources=failed_sources,
        )

    def find(self, pool_id: PoolId) -> Pool | None:
        return self.by_id.get(str(pool_id))

    def age(self, now: datetime) -> timedelta:
        return now - self.taken_at

    def is_stale(self, now: datetime, after: timedelta) -> bool:
        """Old enough that a caller should be told so.

        The threshold is passed in rather than known here: how old is too old
        is an operational decision, and the model should not pretend to own it.
        """
        return self.age(now) > after

    def is_empty(self) -> bool:
        return not self.by_id
