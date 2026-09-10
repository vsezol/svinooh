"""Fixtures shared across the layers.

The important one is `client`: it builds the *real* application — real routes,
real dependencies, real use cases — around a fake source and a frozen clock.
Nothing is patched and no private attribute is reached into, which is the test
that the seams in `earn.api.app` are real rather than decorative.
"""
from collections.abc import Iterator, Sequence
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from earn.api.app import create_app
from earn.application.catalog_store import CatalogStore
from earn.application.queries import LendQueries
from earn.domain.catalog import Catalog, ListingPolicy
from earn.domain.pool import Pool
from earn.domain.values import Usd
from earn.infrastructure.kamino.api import KaminoApi
from earn.infrastructure.kamino.source import KaminoSource
from earn.infrastructure.settings import Settings
from tests.fixtures.kamino import RecordedKamino

NOON = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)


class FrozenClock:
    """Time that only moves when a test says so."""

    def __init__(self, now: datetime = NOON) -> None:
        self.now = now

    def __call__(self) -> datetime:
        return self.now

    def advance(self, delta: timedelta) -> None:
        self.now += delta


class StubSource:
    def __init__(self, pools: Sequence[Pool], *, name: str = "stub") -> None:
        self._pools = pools
        self._name = name
        self.fetches = 0

    @property
    def name(self) -> str:
        return self._name

    async def fetch(self) -> Sequence[Pool]:
        self.fetches += 1
        return self._pools


class BrokenSource:
    def __init__(self, name: str = "broken") -> None:
        self._name = name

    @property
    def name(self) -> str:
        return self._name

    async def fetch(self) -> Sequence[Pool]:
        raise RuntimeError("upstream is down")


@pytest.fixture
def settings() -> Settings:
    # Explicit rather than read from the environment: a test that behaves
    # differently on somebody's laptop is not a test.
    return Settings(
        min_tvl_usd=100_000,
        EARN_EXCLUDED_NAME_MARKS="test,staging",
        refresh_interval_s=3600,
        stale_after_s=900,
    )


@pytest.fixture
def policy(settings: Settings) -> ListingPolicy:
    return ListingPolicy(
        min_tvl=Usd(settings.min_tvl_usd),
        excluded_name_marks=settings.excluded_name_marks,
    )


@pytest.fixture
async def pools() -> Sequence[Pool]:
    """Everything the recorded Kamino payloads map to."""
    return await KaminoSource(KaminoApi(RecordedKamino())).fetch()


@pytest.fixture
def catalog(pools: Sequence[Pool], policy: ListingPolicy) -> Catalog:
    return Catalog.build(version=7, taken_at=NOON, pools=pools, policy=policy)


@pytest.fixture
def store(catalog: Catalog) -> CatalogStore:
    store = CatalogStore(history=3)
    store.publish(catalog)
    return store


@pytest.fixture
def queries(store: CatalogStore) -> LendQueries:
    return LendQueries(store)


@pytest.fixture
def clock() -> FrozenClock:
    return FrozenClock()


@pytest.fixture
def client(settings: Settings, pools: Sequence[Pool], clock: FrozenClock) -> Iterator[TestClient]:
    app = create_app(settings, sources=[StubSource(pools)], clock=clock)
    with TestClient(app) as running:
        yield running


@pytest.fixture
def cold_client(settings: Settings, clock: FrozenClock) -> Iterator[TestClient]:
    """An application whose only source is broken: never ready, never empty-and-lying."""
    app = create_app(settings, sources=[BrokenSource()], clock=clock)
    with TestClient(app) as running:
        yield running
