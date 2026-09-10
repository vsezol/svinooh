"""Filtering, sorting, and the cursor — the part that has to stay honest.

The listing is sorted by a number that changes all day. Everything here is
about one guarantee: a client that starts reading a list finishes reading that
same list, and is told plainly when it cannot.
"""
import pytest

from app import query as q


def page(snapshot, **kwargs):
    cursor = kwargs.pop("cursor", None)
    return q.run(q.PoolQuery(**kwargs), cursor, snapshot, lambda _id: snapshot if _id == snapshot.id else None)


async def test_only_pools_worth_listing_are_listed(snapshot):
    names = {pool.name for pool in snapshot.listed}
    # 5 USD of deposits and "Testing" in the name: still a real vault, just not
    # one to show anybody
    assert not any("Testing" in name for name in names)
    # A reserve under the floor goes the same way, by the same rule
    assert not any("adraSOL" in name for name in names)
    assert len(snapshot.listed) == 4


async def test_an_unlisted_pool_is_still_addressable(snapshot):
    """Somebody may hold shares in it, and asking by id must not answer 404."""
    assert "sol:kamino:vault:CwptesNGAXj8S3aRsFHtUomb5zqAA1tMJBYkQVLJjXmd" in snapshot.by_id


async def test_default_order_is_the_best_rate_first(snapshot):
    result = page(snapshot, limit=10)
    rates = [pool.apy.net for pool in result.pools]
    assert rates == sorted(rates, reverse=True)
    assert "Sentora" in result.pools[0].name


async def test_filters_narrow_by_ticker_and_by_kind(snapshot):
    assert {pool.token.symbol for pool in page(snapshot, token="pyusd", limit=10).pools} == {"PYUSD"}
    assert {pool.kind for pool in page(snapshot, kind="reserve", limit=10).pools} == {"reserve"}
    assert page(snapshot, token="PYUSD", kind="vault", limit=10).total == 1


async def test_paging_visits_every_pool_exactly_once(snapshot):
    seen, cursor = [], None
    while True:
        result = page(snapshot, limit=2, cursor=cursor)
        seen.extend(pool.id for pool in result.pools)
        cursor = result.next_cursor
        if not cursor:
            break
    assert len(seen) == len(set(seen)) == snapshot.listed.__len__()


async def test_a_cursor_from_another_query_is_refused(snapshot):
    """Reusing it against different filters would silently return the wrong page."""
    cursor = page(snapshot, limit=1).next_cursor
    with pytest.raises(q.QueryError) as raised:
        page(snapshot, kind="reserve", limit=1, cursor=cursor)
    assert raised.value.kind == "cursor-query-mismatch"


async def test_a_cursor_into_a_forgotten_snapshot_says_so(snapshot):
    """Better than restarting from the newest list and handing back duplicates."""
    cursor = page(snapshot, limit=1).next_cursor
    with pytest.raises(q.QueryError) as raised:
        q.run(q.PoolQuery(limit=1), cursor, snapshot, lambda _id: None)
    assert raised.value.kind == "cursor-expired"


async def test_page_size_may_change_mid_read(snapshot):
    """It does not change which list is being read, so the cursor still fits."""
    first = page(snapshot, limit=1)
    second = page(snapshot, limit=3, cursor=first.next_cursor)
    assert len(second.pools) == 3


def test_an_unknown_sort_is_a_bad_request():
    with pytest.raises(q.QueryError):
        q.parse_sort("apy_desc")
