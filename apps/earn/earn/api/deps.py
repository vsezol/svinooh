"""What a request needs, resolved by FastAPI.

Two jobs. One: hand a route the collaborators wired up at startup — nothing in
this service reaches for a module-level singleton, which is what makes a test
able to build the whole application around a fake source instead of patching a
private attribute.

Two: turn query strings into domain objects at the edge, so no route ever sees
a raw `str` where the model expects a `Network`. Everything below is declared,
so an unknown network or a nonsense number is a 422 with a message before any
of our code runs.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import Annotated

from fastapi import Depends, Query, Request

from earn.api.cursors import decode
from earn.application.queries import LendQueries, Resume
from earn.domain.selection import PoolFilter, PoolSelection, SortKey, SortOrder
from earn.domain.values import Network, PoolKind, Protocol, Rate, Usd
from earn.infrastructure.settings import Settings


class SortParam(StrEnum):
    """The orderings a client may ask for, spelled the way the API spells them.

    An enum rather than free text so that the choices are in the generated
    OpenAPI and a typo is a 422 with a list of what was allowed.
    """

    APY_DESC = "-apy"
    APY_ASC = "apy"
    TVL_DESC = "-tvl_usd"
    TVL_ASC = "tvl_usd"
    NAME_ASC = "name"
    NAME_DESC = "-name"

    def to_order(self) -> SortOrder:
        descending = self.value.startswith("-")
        return SortOrder(key=SortKey(self.value.lstrip("-")), descending=descending)


def get_settings(request: Request) -> Settings:
    settings: Settings = request.app.state.settings
    return settings


def get_queries(request: Request) -> LendQueries:
    queries: LendQueries = request.app.state.queries
    return queries


def get_now(request: Request) -> datetime:
    now: datetime = request.app.state.clock()
    return now


def pool_filter(
    network: Annotated[Network | None, Query(description="`sol` today")] = None,
    protocol: Annotated[Protocol | None, Query(description="`kamino` today")] = None,
    token: Annotated[str | None, Query(description="Ticker, case-insensitive")] = None,
    mint: Annotated[
        str | None, Query(description="Exact mint — unambiguous where a ticker is not")
    ] = None,
    kind: Annotated[
        PoolKind | None, Query(description="`vault` (curated) or `reserve` (direct supply)")
    ] = None,
    min_tvl_usd: Annotated[Decimal | None, Query(ge=0)] = None,
    min_apy: Annotated[Decimal | None, Query(ge=0, description="A fraction: 0.05 is 5%")] = None,
) -> PoolFilter:
    return PoolFilter(
        network=network,
        protocol=protocol,
        token=token,
        mint=mint,
        kind=kind,
        min_tvl=Usd(min_tvl_usd) if min_tvl_usd is not None else None,
        min_apy=Rate(min_apy) if min_apy is not None else None,
    )


def pool_selection(
    chosen: Annotated[PoolFilter, Depends(pool_filter)],
    sort: Annotated[SortParam, Query()] = SortParam.APY_DESC,
) -> PoolSelection:
    return PoolSelection(filter=chosen, sort=sort.to_order())


def page_size(
    settings: Annotated[Settings, Depends(get_settings)],
    limit: Annotated[int | None, Query(ge=1)] = None,
) -> int:
    return min(limit or settings.default_page_size, settings.max_page_size)


def resume_from(
    cursor: Annotated[
        str | None, Query(description="From meta.next_cursor of the previous page")
    ] = None,
) -> Resume | None:
    """Decoded here so a route never handles the encoding.

    A malformed cursor raises, and the problem table turns it into a 400 that
    says which kind of wrong it is.
    """
    return decode(cursor) if cursor else None
