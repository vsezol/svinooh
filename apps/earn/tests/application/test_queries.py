"""The three questions, and the rules about resuming a page."""
import pytest

from earn.application.errors import CatalogVersionGone, PoolNotFound, SelectionMismatch
from earn.application.queries import LendQueries, Resume
from earn.domain.catalog import Catalog, ListingPolicy
from earn.domain.selection import PoolFilter, PoolSelection
from earn.domain.values import PoolKind
from tests.conftest import NOON


def resume_of(answer) -> Resume:
    assert answer.resume is not None
    return answer.resume


def test_paging_visits_every_pool_exactly_once(queries: LendQueries):
    seen: list[str] = []
    selection, resume = PoolSelection(), None
    while True:
        answer = queries.list_pools(selection, limit=2, resume=resume)
        seen.extend(str(pool.id) for pool in answer.page.items)
        resume = answer.resume
        if resume is None:
            break

    assert len(seen) == len(set(seen)) == answer.page.total


def test_a_cursor_from_another_query_is_refused(queries: LendQueries):
    """Reusing it against different filters would silently return the wrong page."""
    resume = resume_of(queries.list_pools(PoolSelection(), limit=1))
    with pytest.raises(SelectionMismatch):
        queries.list_pools(
            PoolSelection(filter=PoolFilter(kind=PoolKind.RESERVE)), limit=1, resume=resume
        )


def test_a_cursor_into_a_forgotten_catalog_says_so(queries: LendQueries, store, catalog: Catalog):
    """Better than restarting from the newest list and handing back duplicates."""
    resume = resume_of(queries.list_pools(PoolSelection(), limit=1))
    for version in range(8, 12):
        store.publish(
            Catalog.build(
                version=version,
                taken_at=NOON,
                pools=catalog.by_id.values(),
                policy=ListingPolicy(min_tvl=catalog.listed[0].tvl_usd),
            )
        )
    with pytest.raises(CatalogVersionGone):
        queries.list_pools(PoolSelection(), limit=1, resume=resume)


def test_page_size_may_change_mid_read(queries: LendQueries):
    """It does not change which list is being read, so the cursor still fits."""
    first = queries.list_pools(PoolSelection(), limit=1)
    second = queries.list_pools(PoolSelection(), limit=3, resume=resume_of(first))
    assert len(second.page.items) == 3


def test_a_page_is_read_from_the_catalog_the_cursor_names(
    queries: LendQueries, store, catalog: Catalog
):
    """The point of the whole arrangement: the list does not move under a reader."""
    first = queries.list_pools(PoolSelection(), limit=1)
    store.publish(
        Catalog.build(
            version=8,
            taken_at=NOON,
            pools=[],
            policy=ListingPolicy(min_tvl=catalog.listed[0].tvl_usd),
        )
    )

    second = queries.list_pools(PoolSelection(), limit=1, resume=resume_of(first))
    assert second.catalog.version == 7
    assert second.page.items


def test_an_unknown_pool_is_a_named_failure(queries: LendQueries):
    with pytest.raises(PoolNotFound):
        queries.get_pool("sol:kamino:vault:nope")
    with pytest.raises(PoolNotFound):
        queries.get_pool("not-an-id")


def test_tokens_can_be_narrowed_like_pools(queries: LendQueries):
    every = queries.list_tokens(PoolFilter())
    vaults_only = queries.list_tokens(PoolFilter(kind=PoolKind.VAULT))
    assert len(vaults_only.tokens) < len(every.tokens)
