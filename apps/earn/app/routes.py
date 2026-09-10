"""The HTTP surface.

Three reads, and the shape of them is the whole design decision:

    GET /v1/lend/pools            the list, narrowed by query parameters
    GET /v1/lend/pools/{pool_id}  one pool, by an id that stands on its own
    GET /v1/lend/tokens           what can be earned on, best rate per token

A pool is identified by `pool_id` and by nothing else. It is tempting to write
`/lend/sol/USDC/{pool}`, because that is how a person describes their way to
it, but a token is a *filter over* pools, not a *parent of* one: the vault is
already unique without it. Putting it in the path gives one resource two URLs,
one of which can contradict itself (what is `/lend/sol/USDC/<a PYUSD vault>`?),
and every such question has to be answered in code. Filters belong in the query
string, where adding the next one — protocol, kind, a TVL floor — costs a
parameter instead of a path level.
"""
from decimal import Decimal, InvalidOperation
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query

from . import query as q
from . import wire
from .catalog import Snapshot, catalog
from .config import settings

router = APIRouter(prefix="/v1/lend", tags=["lend"])


def _snapshot() -> Snapshot:
    snapshot = catalog.current()
    if snapshot is None:
        # Nothing has been fetched yet — a few seconds after a cold start, or
        # Kamino was unreachable for the whole of it. Either way this is "not
        # ready", not "no pools exist", and the status code has to say which.
        raise HTTPException(status_code=503, detail="the catalog has not been built yet")
    return snapshot


def _decimal(raw: str | None, name: str) -> Decimal | None:
    if raw is None:
        return None
    try:
        return Decimal(raw)
    except InvalidOperation as error:
        raise q.QueryError("invalid-parameter", f"{name} must be a number") from error


@router.get("/pools", response_model=wire.PoolListResponse)
async def list_pools(
    network: Annotated[str | None, Query(description="`sol` today")] = None,
    protocol: Annotated[str | None, Query(description="`kamino` today")] = None,
    token: Annotated[str | None, Query(description="Ticker, case-insensitive")] = None,
    mint: Annotated[str | None, Query(description="Exact mint address — unambiguous where a ticker is not")] = None,
    kind: Annotated[str | None, Query(description="`vault` (curated) or `reserve` (direct supply)")] = None,
    min_tvl_usd: Annotated[str | None, Query()] = None,
    min_apy: Annotated[str | None, Query(description="A fraction: 0.05 is 5%")] = None,
    sort: Annotated[str | None, Query(description="apy | tvl_usd | name, '-' for descending")] = None,
    limit: Annotated[int | None, Query(ge=1)] = None,
    cursor: Annotated[str | None, Query(description="From meta.next_cursor of the previous page")] = None,
) -> wire.PoolListResponse:
    snapshot = _snapshot()
    page = q.run(
        q.PoolQuery(
            network=network,
            protocol=protocol,
            token=token,
            mint=mint,
            kind=kind,
            min_tvl_usd=_decimal(min_tvl_usd, "min_tvl_usd"),
            min_apy=_decimal(min_apy, "min_apy"),
            sort=q.parse_sort(sort),
            limit=min(limit or settings.default_page_size, settings.max_page_size),
        ),
        cursor,
        snapshot,
        catalog.find,
    )
    return wire.PoolListResponse(
        data=[wire.summary_of(pool) for pool in page.pools],
        meta=wire.meta_of(
            page.snapshot,
            count=len(page.pools),
            total=page.total,
            next_cursor=page.next_cursor,
        ),
    )


@router.get("/pools/{pool_id}", response_model=wire.PoolResponse)
async def get_pool(pool_id: str) -> wire.PoolResponse:
    snapshot = _snapshot()
    # Looked up in every pool, not only the listed ones: a pool below the
    # listing floor is still a pool somebody may hold a position in, and
    # answering 404 for one that exists would be a lie about the chain.
    pool = snapshot.by_id.get(pool_id)
    if pool is None:
        raise HTTPException(status_code=404, detail=f"no pool with id {pool_id}")
    return wire.PoolResponse(data=wire.detail_of(pool), meta=wire.meta_of(snapshot))


@router.get("/tokens", response_model=wire.TokenListResponse)
async def list_tokens(
    network: Annotated[str | None, Query()] = None,
    protocol: Annotated[str | None, Query()] = None,
) -> wire.TokenListResponse:
    """What is earnable, one row per token.

    The agent's first question is almost never "list every pool" — it is "what
    can I do with my USDC". Answering that from the pool list means fetching a
    few hundred rows to reduce them to a dozen, on every turn, so the reduction
    lives here instead.
    """
    snapshot = _snapshot()
    selector = q.PoolQuery(network=network, protocol=protocol)
    best: dict[str, tuple] = {}
    for pool in snapshot.listed:
        if not selector.matches(pool):
            continue
        key = f"{pool.network}:{pool.token.mint}"
        count, tvl, top = best.get(key, (0, Decimal(0), pool))
        best[key] = (
            count + 1,
            tvl + pool.tvl_usd,
            pool if pool.apy.net > top.apy.net else top,
        )

    rows = [
        wire.TokenSummary(
            symbol=top.token.symbol,
            mint=top.token.mint,
            decimals=top.token.decimals,
            network=top.network,
            pool_count=count,
            best_apy=wire.rate(top.apy.net) or "0",
            best_pool_id=top.id,
            tvl_usd=wire.usd(tvl) or "0",
        )
        for count, tvl, top in best.values()
    ]
    rows.sort(key=lambda row: Decimal(row.tvl_usd), reverse=True)
    return wire.TokenListResponse(data=rows, meta=wire.meta_of(snapshot, count=len(rows), total=len(rows)))
