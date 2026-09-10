"""`/v1/lend` — the three questions, over HTTP.

Each handler does three things and nothing else: take what the dependencies
already turned into domain objects, ask a use case, hand the answer to a
presenter. Any `if` that appears here is a rule that belongs a layer down.

On the shape of these URLs. The obvious one is `/lend/{chain}/{token}/{pool}`,
because that is how a person describes the way to a pool. It is wrong for one
reason: **a path segment is identity, a query parameter is a filter.** A pool
is already unique without its token, so putting the token in the path gives one
resource two URLs, one of which can contradict itself — what is
`/lend/sol/USDC/<a PYUSD vault>`, a 404 or a redirect? Every such question has
to be answered in code, forever. Filters go in the query string, where the next
one costs a parameter instead of a path level.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends

from earn.api import presenters
from earn.api.cursors import encode
from earn.api.deps import (
    get_now,
    get_queries,
    get_settings,
    page_size,
    pool_filter,
    pool_selection,
    resume_from,
)
from earn.api.schemas import PoolListResponse, PoolResponse, TokenListResponse
from earn.application.queries import LendQueries, Resume
from earn.domain.selection import PoolFilter, PoolSelection
from earn.infrastructure.settings import Settings

router = APIRouter(prefix="/v1/lend", tags=["lend"])


@router.get("/pools", response_model=PoolListResponse, summary="List pools")
async def list_pools(
    queries: Annotated[LendQueries, Depends(get_queries)],
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_now)],
    selection: Annotated[PoolSelection, Depends(pool_selection)],
    limit: Annotated[int, Depends(page_size)],
    resume: Annotated[Resume | None, Depends(resume_from)],
) -> PoolListResponse:
    answer = queries.list_pools(selection, limit=limit, resume=resume)
    return PoolListResponse(
        data=[presenters.summary(pool) for pool in answer.page.items],
        meta=presenters.meta(
            answer.catalog,
            now,
            settings.stale_after,
            count=len(answer.page.items),
            total=answer.page.total,
            next_cursor=encode(answer.resume) if answer.resume is not None else None,
        ),
    )


@router.get("/pools/{pool_id}", response_model=PoolResponse, summary="One pool, in full")
async def get_pool(
    pool_id: str,
    queries: Annotated[LendQueries, Depends(get_queries)],
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_now)],
) -> PoolResponse:
    answer = queries.get_pool(pool_id)
    return PoolResponse(
        data=presenters.detail(answer.pool),
        meta=presenters.meta(answer.catalog, now, settings.stale_after),
    )


@router.get("/tokens", response_model=TokenListResponse, summary="What can be earned on")
async def list_tokens(
    queries: Annotated[LendQueries, Depends(get_queries)],
    settings: Annotated[Settings, Depends(get_settings)],
    now: Annotated[datetime, Depends(get_now)],
    chosen: Annotated[PoolFilter, Depends(pool_filter)],
) -> TokenListResponse:
    answer = queries.list_tokens(chosen)
    return TokenListResponse(
        data=[presenters.token_yield(row) for row in answer.tokens],
        meta=presenters.meta(
            answer.catalog,
            now,
            settings.stale_after,
            count=len(answer.tokens),
            total=len(answer.tokens),
        ),
    )
