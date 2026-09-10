from datetime import datetime, timezone

import pytest

from app.catalog import Snapshot, _worth_listing
from app.sources import kamino

from .fixtures import FakeKamino


@pytest.fixture
async def snapshot() -> Snapshot:
    """A snapshot built from the fixtures, the way a refresh would build it."""
    pools = await kamino.fetch_pools(FakeKamino())
    return Snapshot(
        id=7,
        at=datetime.now(timezone.utc),
        listed=tuple(pool for pool in pools if _worth_listing(pool)),
        by_id={pool.id: pool for pool in pools},
    )
