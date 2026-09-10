"""The loop: what it publishes, and what it refuses to publish."""
import asyncio
from collections.abc import Sequence
from datetime import timedelta

import pytest

from earn.application.catalog_store import CatalogStore
from earn.application.errors import CatalogNotReady
from earn.application.refresher import CatalogRefresher
from earn.domain.catalog import ListingPolicy
from earn.domain.pool import Pool
from tests.conftest import BrokenSource, FrozenClock, StubSource


def refresher(sources, store, policy, clock) -> CatalogRefresher:
    return CatalogRefresher(
        sources=sources, store=store, policy=policy, clock=clock, interval=timedelta(hours=1)
    )


async def test_a_refresh_publishes_a_catalog(pools: Sequence[Pool], policy: ListingPolicy):
    store, clock = CatalogStore(), FrozenClock()
    catalog = await refresher([StubSource(pools)], store, policy, clock).refresh_once()

    assert catalog is not None
    assert catalog.version == 1
    assert store.current() is catalog
    assert catalog.taken_at == clock.now
    assert catalog.failed_sources == ()


async def test_one_broken_source_does_not_cost_us_the_others(
    pools: Sequence[Pool], policy: ListingPolicy
):
    store = CatalogStore()
    catalog = await refresher(
        [StubSource(pools), BrokenSource("kamino")], store, policy, FrozenClock()
    ).refresh_once()

    assert catalog is not None
    assert catalog.listed  # the working source still answered
    # …and the answer says plainly that it is incomplete, which is a different
    # problem from being merely old
    assert catalog.failed_sources == ("kamino",)


async def test_an_empty_refresh_never_replaces_a_good_catalog(
    pools: Sequence[Pool], policy: ListingPolicy
):
    """A source silent because it is broken must not read as "there is nothing"."""
    store, clock = CatalogStore(), FrozenClock()
    good = await refresher([StubSource(pools)], store, policy, clock).refresh_once()

    kept = await refresher([BrokenSource()], store, policy, clock).refresh_once()

    assert kept is good
    assert store.current() is good


async def test_nothing_to_serve_is_not_an_empty_list(policy: ListingPolicy):
    store = CatalogStore()
    await refresher([BrokenSource()], store, policy, FrozenClock()).refresh_once()
    with pytest.raises(CatalogNotReady):
        store.current()


async def test_the_loop_outlives_a_failing_refresh(policy: ListingPolicy):
    """The failure that matters is the loop dying: then data ages and nobody is told."""
    store = CatalogStore()
    loop = refresher([BrokenSource()], store, policy, FrozenClock())
    task = asyncio.create_task(loop.run_forever())
    await asyncio.wait_for(loop.first_pass.wait(), timeout=1)

    assert not task.done()
    task.cancel()


async def test_the_store_keeps_a_bounded_history(pools: Sequence[Pool], policy: ListingPolicy):
    store = CatalogStore(history=2)
    loop = refresher([StubSource(pools)], store, policy, FrozenClock())
    for _ in range(3):
        await loop.refresh_once()

    assert store.version(1) is None  # dropped
    assert store.version(3) is not None
