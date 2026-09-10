"""The one place the host's JSON becomes the domain's types.

Everything above the adapter is typed, which is only true if this holds: the
camelCase names, the nulls where the DTO promises a number, the lists that
arrive as `null`, and the fields we do not read at all.
"""

import pytest
from pydantic import ValidationError

from app.adapters import wire
from tests import fixtures as fx


class TestReadingAPortfolio:
    def test_the_wire_names_are_read_into_our_own(self):
        parsed = wire.position(fx.ETH)
        assert (parsed.value_usd, parsed.price_usd) == (16_683.65, 2_485.59)

    def test_a_lending_position_keeps_its_rates_and_its_legs(self):
        parsed = wire.position(fx.AAVE)
        assert (parsed.health_rate, parsed.borrow_apy) == (2.14, 0.032)
        assert [(leg.symbol, leg.role) for leg in parsed.legs] == [
            ("WETH", "supply"),
            ("USDC", "borrow"),
        ]

    def test_a_pool_keeps_its_pair_and_its_verdict(self):
        parsed = wire.position(fx.UNISWAP)
        assert parsed.band is not None and parsed.band.pair == "cbBTC/USDC"
        assert (parsed.band.fee_pct, parsed.range) == (0.05, "in")

    def test_a_band_with_no_pair_is_no_band(self):
        # The field exists on every position; only a liquidity one fills it.
        assert wire.position({"symbol": "X", "valueUsd": 1.0, "band": {}}).band is None

    def test_a_null_list_is_an_empty_one(self):
        # `tokens: null` on every plain holding, `positions: null` on a wallet
        # that has not been scanned. Both mean none of them.
        assert wire.position({"symbol": "X", "valueUsd": 1.0, "tokens": None}).legs == ()
        parsed = wire.portfolio({"slug": "s", "totalUsd": 0, "wallets": None})
        assert parsed.wallets == ()

    def test_a_field_we_do_not_read_is_not_an_error(self):
        # The API sends ids, timestamps and TRON resources this service never
        # reads, and a new one there must never be a failed turn here.
        parsed = wire.portfolio(
            {"slug": "s", "totalUsd": 1.0, "somethingNew": {"deeply": ["nested"]}, "wallets": []}
        )
        assert parsed.slug == "s"

    def test_the_whole_fixture_survives_the_round_trip(self):
        parsed = wire.portfolio(fx.rich_portfolio(tail=3))
        assert parsed.title == "Main portfolio"
        assert len(parsed.positions) == 8
        assert parsed.total_usd == fx.rich_portfolio(tail=3)["totalUsd"]

    def test_a_payload_of_the_wrong_shape_is_refused(self):
        # Rather than read as an empty portfolio: the caller degrades honestly
        # and says the numbers are unavailable, which beats a prompt of "n/a".
        with pytest.raises(ValidationError):
            wire.portfolio({"slug": "s", "totalUsd": "a lot"})


class TestReadingHistory:
    def test_a_reading_with_no_total_is_not_a_reading(self):
        series = wire.history({"range": "7d", "points": [{"t": "2026-09-01", "usd": None}]})
        assert series.readings == ()

    def test_the_timestamp_is_kept_as_written_and_as_a_number(self):
        series = wire.history(
            {"range": "7d", "points": [{"t": "2026-09-01T00:00:00Z", "usd": 1.0}]}
        )
        reading = series.readings[0]
        assert reading.at == "2026-09-01T00:00:00Z", "quoted back in the answer"
        assert reading.epoch_ms is not None

    @pytest.mark.parametrize(
        ("stamp", "readable"),
        [("2026-09-01T00:00:00Z", True), (1_788_220_800_000, True), ("not-a-date", False)],
        ids=["iso", "epoch", "junk"],
    )
    def test_what_can_and_cannot_be_placed_in_time(self, stamp, readable):
        assert (wire.epoch_ms(stamp) is not None) is readable


class TestReadingTheHost:
    def test_who_the_caller_is_and_what_they_own(self):
        me = wire.me({"id": "u1", "portfolios": [{"slug": "mine", "name": "Main"}]})
        assert me.user_id == "u1"
        assert [(p.slug, p.name) for p in me.portfolios] == [("mine", "Main")]

    def test_a_caller_who_owns_nothing(self):
        assert wire.me({"id": "u1", "portfolios": None}).portfolios == ()

    def test_a_create_answers_with_a_slug(self):
        assert wire.slug({"slug": "new-pf", "name": None}) == "new-pf"
