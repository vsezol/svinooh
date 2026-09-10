"""What goes in a catalog, and what the listing policy keeps out."""
from datetime import timedelta

from earn.domain.catalog import Catalog
from tests.conftest import NOON


def test_only_pools_worth_listing_are_listed(catalog: Catalog):
    names = {pool.name for pool in catalog.listed}
    # $5 of deposits and "Testing" in the name: a real vault, not one to show
    assert not any("Testing" in name for name in names)
    # A reserve under the floor goes the same way, by the same rule
    assert not any("adraSOL" in name for name in names)
    assert len(catalog.listed) == 4


def test_an_unlisted_pool_is_still_addressable(catalog: Catalog):
    """Somebody may hold shares in it; 404 would be a lie about the chain."""
    assert catalog.by_id["sol:kamino:vault:CwptesNGAXj8S3aRsFHtUomb5zqAA1tMJBYkQVLJjXmd"]
    assert len(catalog.by_id) > len(catalog.listed)


def test_staleness_is_a_question_about_a_moment(catalog: Catalog):
    assert not catalog.is_stale(NOON + timedelta(minutes=5), timedelta(minutes=15))
    assert catalog.is_stale(NOON + timedelta(minutes=20), timedelta(minutes=15))
