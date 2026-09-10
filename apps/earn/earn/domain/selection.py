"""Choosing pools out of a catalog: which ones, in what order, and which slice.

This is the specification pattern, and it is here rather than in a query
handler for one reason: a selection has an *identity*. A cursor has to be able
to say "the page after this one, of that same list", and that means the list
has to be nameable. `fingerprint()` is that name.

Nothing here knows what a cursor looks like on the wire — encoding one is a
transport concern and lives in the api layer.
"""
from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from decimal import Decimal
from enum import StrEnum
from typing import Any

from earn.domain.pool import Pool
from earn.domain.values import Network, PoolKind, Protocol, Rate, Usd


class SortKey(StrEnum):
    APY = "apy"
    TVL_USD = "tvl_usd"
    NAME = "name"


_KEYS: dict[SortKey, Callable[[Pool], Any]] = {
    SortKey.APY: lambda pool: pool.apy.net,
    SortKey.TVL_USD: lambda pool: pool.tvl_usd,
    SortKey.NAME: lambda pool: pool.name.lower(),
}


@dataclass(frozen=True, slots=True)
class SortOrder:
    key: SortKey = SortKey.APY
    descending: bool = True

    def __str__(self) -> str:
        return f"{'-' if self.descending else ''}{self.key}"


@dataclass(frozen=True, slots=True)
class PoolFilter:
    """Which pools are in the list at all."""

    network: Network | None = None
    protocol: Protocol | None = None
    #: A ticker, matched case-insensitively. Ambiguous by nature — several
    #: mints call themselves USDC — which is why `mint` exists beside it.
    token: str | None = None
    mint: str | None = None
    kind: PoolKind | None = None
    min_tvl: Usd | None = None
    min_apy: Rate | None = None

    def matches(self, pool: Pool) -> bool:
        # The two `unreachable` waivers are temporary and load-bearing: `Network`
        # and `Protocol` have one member each today, so a type checker can prove
        # the comparison never fails. The filters are still right, and the day a
        # second network or protocol appears the waivers stop being needed. They
        # are not ignoring a bug; they are ignoring a fact that is about to
        # stop being true.
        if self.network is not None and pool.network != self.network:
            return False  # type: ignore[unreachable]
        if self.protocol is not None and pool.protocol != self.protocol:
            return False  # type: ignore[unreachable]
        if self.kind is not None and pool.kind != self.kind:
            return False
        if self.mint is not None and pool.token.mint != self.mint:
            return False
        if self.token is not None and pool.token.symbol.upper() != self.token.upper():
            return False
        if self.min_tvl is not None and pool.tvl_usd < self.min_tvl:
            return False
        return not (self.min_apy is not None and pool.apy.net < self.min_apy)


@dataclass(frozen=True, slots=True)
class PoolSelection:
    """A filter and an order — together, one nameable list."""

    filter: PoolFilter = PoolFilter()
    sort: SortOrder = SortOrder()

    def apply(self, pools: Iterable[Pool]) -> list[Pool]:
        chosen = [pool for pool in pools if self.filter.matches(pool)]
        key = _KEYS[self.sort.key]
        # The id breaks ties, so two pools paying the same rate keep a stable
        # order between requests. Without it, paging could skip one.
        return sorted(
            chosen, key=lambda pool: (key(pool), str(pool.id)), reverse=self.sort.descending
        )

    def fingerprint(self) -> str:
        """Identifies this list, so a cursor cannot be used against another one.

        Page size is deliberately not part of it: changing it midway is a
        legitimate thing for a client to do and does not change which list is
        being read. Everything that *does* change the list is in.
        """
        shape = json.dumps(
            {
                "network": self.filter.network,
                "protocol": self.filter.protocol,
                "token": (self.filter.token or "").upper() or None,
                "mint": self.filter.mint,
                "kind": self.filter.kind,
                "min_tvl": _plain(self.filter.min_tvl.value if self.filter.min_tvl else None),
                "min_apy": _plain(self.filter.min_apy.value if self.filter.min_apy else None),
                "sort": str(self.sort),
            },
            sort_keys=True,
        )
        return hashlib.sha256(shape.encode()).hexdigest()[:12]


def _plain(value: Decimal | None) -> str | None:
    return str(value) if value is not None else None


@dataclass(frozen=True, slots=True)
class Page:
    """One slice of a selection, and how to ask for the next."""

    items: tuple[Pool, ...]
    total: int
    next_offset: int | None


def paginate(pools: list[Pool], *, offset: int, limit: int) -> Page:
    window = pools[offset : offset + limit]
    consumed = offset + len(window)
    return Page(
        items=tuple(window),
        total=len(pools),
        next_offset=consumed if consumed < len(pools) else None,
    )
