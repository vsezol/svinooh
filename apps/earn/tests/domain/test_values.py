"""The vocabulary, and the mistake it exists to prevent."""
from decimal import Decimal

import pytest

from earn.domain.values import Network, PoolId, PoolKind, Protocol, Rate, Usd


def test_a_rate_and_a_price_cannot_be_added():
    """The whole reason `Rate` exists: 5.08 and 0.0508 look identical in a Decimal."""
    with pytest.raises(TypeError):
        Rate(Decimal("0.05")) + Usd(Decimal("100"))  # type: ignore[operator]


def test_rates_add_and_order():
    assert Rate(Decimal("0.02")) + Rate(Decimal("0.03")) == Rate(Decimal("0.05"))
    assert Rate(Decimal("0.05")) > Rate.ZERO
    assert not Rate.ZERO.is_positive()


def test_as_percent_is_for_reading_only():
    assert Rate(Decimal("0.0508")).as_percent() == Decimal("5.0800")


def test_a_pool_id_survives_a_round_trip():
    original = PoolId(Network.SOLANA, Protocol.KAMINO, PoolKind.VAULT, "A2wsxh")
    assert str(original) == "sol:kamino:vault:A2wsxh"
    assert PoolId.parse(str(original)) == original


@pytest.mark.parametrize("broken", ["", "nope", "sol:kamino:vault", "sol:aave:vault:x", "a:b:c:d"])
def test_an_id_that_is_not_one_is_none_rather_than_an_exception(broken):
    """A malformed id and an id for a pool that does not exist are the same 404."""
    assert PoolId.parse(broken) is None
