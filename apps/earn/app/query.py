"""Filtering, sorting and paging one snapshot.

Nothing here touches the network. A query is a pure function of the snapshot it
runs against, which is what makes a cursor mean something: the cursor names the
snapshot, so page two is computed from exactly the list page one came from.

Why not skip/limit. Sorted by APY, the list reorders continuously — a pool that
was 19th when the client read page one can be 21st when it asks for page two,
and the client sees it twice while never seeing whatever took its place. Offset
paging is correct only over data that does not move, and yields are the
definition of data that moves.
"""
import base64
import binascii
import hashlib
import json
from dataclasses import dataclass
from decimal import Decimal
from typing import Callable

from .catalog import Snapshot
from .domain import Pool

SORT_KEYS: dict[str, Callable[[Pool], object]] = {
    "apy": lambda pool: pool.apy.net,
    "tvl_usd": lambda pool: pool.tvl_usd,
    "name": lambda pool: pool.name.lower(),
}

DEFAULT_SORT = "-apy"


class QueryError(ValueError):
    """A bad request, carrying the machine-readable reason for problem+json."""

    def __init__(self, kind: str, detail: str) -> None:
        super().__init__(detail)
        self.kind = kind
        self.detail = detail


@dataclass(frozen=True)
class PoolQuery:
    network: str | None = None
    protocol: str | None = None
    #: Ticker, matched case-insensitively. Ambiguous by nature — several mints
    #: call themselves USDC — which is why `mint` exists beside it.
    token: str | None = None
    mint: str | None = None
    kind: str | None = None
    min_tvl_usd: Decimal | None = None
    min_apy: Decimal | None = None
    sort: str = DEFAULT_SORT
    limit: int = 20

    def matches(self, pool: Pool) -> bool:
        if self.network and pool.network != self.network:
            return False
        if self.protocol and pool.protocol != self.protocol:
            return False
        if self.kind and pool.kind != self.kind:
            return False
        if self.mint and pool.token.mint != self.mint:
            return False
        if self.token and pool.token.symbol.upper() != self.token.upper():
            return False
        if self.min_tvl_usd is not None and pool.tvl_usd < self.min_tvl_usd:
            return False
        if self.min_apy is not None and pool.apy.net < self.min_apy:
            return False
        return True

    def fingerprint(self) -> str:
        """Identifies the *shape* of this query, so a cursor cannot cross into another.

        `limit` is deliberately not part of it: changing the page size midway
        through is a legitimate thing for a client to do, and it does not change
        which list is being read. Everything that does change the list is in.
        """
        shape = json.dumps(
            {
                "network": self.network,
                "protocol": self.protocol,
                "token": (self.token or "").upper() or None,
                "mint": self.mint,
                "kind": self.kind,
                "min_tvl_usd": str(self.min_tvl_usd) if self.min_tvl_usd is not None else None,
                "min_apy": str(self.min_apy) if self.min_apy is not None else None,
                "sort": self.sort,
            },
            sort_keys=True,
        )
        return hashlib.sha256(shape.encode()).hexdigest()[:12]


def parse_sort(raw: str | None) -> str:
    sort = (raw or DEFAULT_SORT).strip()
    if sort.lstrip("-") not in SORT_KEYS:
        raise QueryError(
            "invalid-sort",
            f"sort must be one of {', '.join(sorted(SORT_KEYS))}, optionally prefixed with '-'",
        )
    return sort


def sorted_pools(pools: list[Pool], sort: str) -> list[Pool]:
    descending = sort.startswith("-")
    key = SORT_KEYS[sort.lstrip("-")]
    # The id is the tiebreaker so that two pools with identical APYs keep a
    # stable order between requests — without it, paging could skip one.
    return sorted(pools, key=lambda pool: (key(pool), pool.id), reverse=descending)


def encode_cursor(snapshot_id: int, offset: int, fingerprint: str) -> str:
    raw = json.dumps({"s": snapshot_id, "o": offset, "q": fingerprint}, separators=(",", ":"))
    return base64.urlsafe_b64encode(raw.encode()).decode().rstrip("=")


def decode_cursor(cursor: str) -> tuple[int, int, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        data = json.loads(base64.urlsafe_b64decode(padded.encode()))
        return int(data["s"]), int(data["o"]), str(data["q"])
    except (KeyError, ValueError, TypeError, binascii.Error, json.JSONDecodeError) as error:
        raise QueryError("invalid-cursor", "cursor is not one we issued") from error


@dataclass(frozen=True)
class Page:
    pools: list[Pool]
    total: int
    next_cursor: str | None
    #: The snapshot actually read: a cursor may point at an older one than the
    #: newest, and the answer must be timestamped with the data it contains.
    snapshot: Snapshot


def run(
    query: PoolQuery,
    cursor: str | None,
    newest: Snapshot,
    find_snapshot,
) -> Page:
    """One page of pools, from the snapshot this cursor belongs to."""
    offset = 0
    snapshot = newest
    if cursor:
        snapshot_id, offset, fingerprint = decode_cursor(cursor)
        if fingerprint != query.fingerprint():
            raise QueryError(
                "cursor-query-mismatch",
                "this cursor was issued for a different set of filters; start again without it",
            )
        found = find_snapshot(snapshot_id)
        if found is None:
            # The data has been rebuilt often enough that the list this cursor
            # points into is gone. Silently restarting from the newest snapshot
            # would hand the client a page that overlaps what it already has, so
            # it is told instead.
            raise QueryError(
                "cursor-expired",
                "the data this cursor points into has been refreshed; start again without it",
            )
        snapshot = found

    matching = sorted_pools([pool for pool in snapshot.listed if query.matches(pool)], query.sort)
    window = matching[offset : offset + query.limit]
    consumed = offset + len(window)
    return Page(
        pools=window,
        total=len(matching),
        next_cursor=(
            encode_cursor(snapshot.id, consumed, query.fingerprint())
            if consumed < len(matching)
            else None
        ),
        snapshot=snapshot,
    )
