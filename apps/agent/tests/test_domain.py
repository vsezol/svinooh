"""The arithmetic a portfolio answers about itself.

These are the numbers an answer is built from, so they are tested as numbers
— on the types, with no renderer, no model and no HTTP in the way. What the
strings around them look like is tests/test_context.py and tests/test_tools.py.
"""

from app.domain.portfolio import (
    WINDOW_MS,
    History,
    Portfolio,
    Position,
    Reading,
    Wallet,
    total_of,
)
from tests import fixtures as fx


def position(symbol: str, value: float, **kwargs) -> Position:
    return Position(symbol=symbol, value_usd=value, **kwargs)


def portfolio_of(*positions: Position) -> Portfolio:
    wallet = Wallet(address="0xabc", chain="EVM", status="ok", positions=positions)
    return Portfolio(slug="p", total_usd=total_of(positions), wallets=(wallet,))


class TestWhatAPositionIs:
    def test_a_holding_in_the_wallet_is_in_no_protocol(self):
        # "wallet" is not a protocol, and counting it as one made the "where
        # is my money" line answer with the wallet it is already grouped by.
        assert position("ETH", 1.0, platform="wallet").protocol is None
        assert position("ETH", 1.0, platform="aave3").protocol == "aave3"
        assert position("ETH", 1.0).protocol is None

    def test_a_search_names_a_position_by_anything_a_person_calls_it(self):
        pool = position("UNI-V3", 1.0, name="Liquidity Pool", platform="uniswap3", network="base")
        assert pool.matches("uniswap"), "the protocol is what somebody asks by"
        assert pool.matches("base") and pool.matches("liquidity") and pool.matches("uni-v3")
        assert not pool.matches("aave")


class TestWhereTheMoneyIs:
    def test_a_breakdown_covers_every_position_and_is_largest_first(self):
        held = portfolio_of(
            position("A", 10.0, network="eth"),
            position("B", 30.0, network="base"),
            position("C", 5.0, network="eth"),
        )
        assert [(t.label, t.usd) for t in held.totals_by(lambda p: p.network)] == [
            ("base", 30.0),
            ("eth", 15.0),
        ]

    def test_a_position_the_grouping_cannot_name_is_left_out(self):
        # Rather than bucketed under a made-up label, which would put money in
        # a chain that does not exist.
        held = portfolio_of(position("A", 10.0, network="eth"), position("B", 30.0))
        assert [t.label for t in held.totals_by(lambda p: p.network)] == ["eth"]

    def test_the_protocols_are_named_once_each_and_never_the_wallet(self):
        held = portfolio_of(
            position("A", 1.0, platform="aave3"),
            position("B", 1.0, platform="aave3"),
            position("C", 1.0, platform="wallet"),
        )
        assert held.protocols == ("aave3",)

    def test_a_search_is_largest_first_and_carries_the_wallet_it_was_found_on(self):
        held = fx.as_portfolio(fx.two_wallet_portfolio())
        found = held.matching("sol")
        assert [m.position.symbol for m in found] == ["SOL"]
        assert found[0].address == fx.SOL_ADDRESS

    def test_an_empty_query_matches_nothing_rather_than_everything(self):
        assert portfolio_of(position("A", 1.0)).matching("   ") == ()

    def test_positions_are_ordered_here_not_trusted_from_the_wire(self):
        # The cap the context block applies can then only drop the tail, which
        # is dust by construction.
        wallet = Wallet(
            address="0xabc",
            chain="EVM",
            status="ok",
            positions=(position("small", 1.0), position("big", 100.0)),
        )
        assert [p.symbol for p in wallet.largest_first] == ["big", "small"]

    def test_a_portfolio_with_no_name_is_called_by_its_slug(self):
        assert Portfolio(slug="abc123", total_usd=0.0).title == "abc123"
        assert Portfolio(slug="abc123", total_usd=0.0, name="Main").title == "Main"


def reading(at: str, usd: float, epoch: float | None = 0.0) -> Reading:
    return Reading(at=at, usd=usd, epoch_ms=epoch)


class TestWhatAPeriodDid:
    def test_the_window_is_counted_back_from_the_last_reading(self):
        series = fx.as_history(
            [
                ("2026-07-28T12:00:00Z", 60_000.0),  # six weeks back
                ("2026-08-31T20:00:00Z", 84_657.5),  # the week opens here
                ("2026-09-07T18:00:00Z", 83_560.55),
            ]
        )
        assert [r.usd for r in series.window("7d").readings] == [84_657.5, 83_560.55]

    def test_all_has_no_window_to_slice(self):
        series = fx.as_history([("2026-07-28T12:00:00Z", 1.0), ("2026-09-07T18:00:00Z", 2.0)])
        assert series.window("all").readings == series.readings

    def test_a_window_with_one_reading_falls_back_to_the_series(self):
        # Better a true statement about a longer span than a made-up one about
        # this one.
        series = fx.as_history([("2026-07-28T12:00:00Z", 1.0), ("2026-09-07T18:00:00Z", 2.0)])
        assert series.window("1h").readings == series.readings

    def test_a_reading_nobody_can_place_in_time_is_outside_every_window(self):
        series = History(
            range="7d",
            readings=(
                reading("not-a-date", 10.0, None),
                reading("2026-09-05T00:00:00Z", 100.0, 1_788_566_400_000.0),
                reading("2026-09-07T00:00:00Z", 110.0, 1_788_739_200_000.0),
            ),
        )
        assert [r.usd for r in series.window("7d").readings] == [100.0, 110.0]

    def test_too_little_history_is_no_change_rather_than_a_made_up_one(self):
        assert fx.as_history([("2026-09-07T18:00:00Z", 100.0)]).change("7d") is None
        assert History(range="7d").change("7d") is None

    def test_the_change_is_the_ends_and_the_extremes_of_the_window(self):
        change = fx.as_history(
            [
                ("2026-09-01T00:00:00Z", 100.0),
                ("2026-09-03T00:00:00Z", 90.0),
                ("2026-09-05T00:00:00Z", 130.0),
                ("2026-09-07T00:00:00Z", 120.0),
            ]
        ).change("7d")
        assert change is not None
        assert (change.first.usd, change.last.usd) == (100.0, 120.0)
        assert (change.low.usd, change.high.usd) == (90.0, 130.0)
        assert change.delta == 20.0 and change.percent == 20.0

    def test_a_portfolio_that_started_at_nothing_does_not_divide_by_zero(self):
        change = fx.as_history(
            [("2026-09-06T00:00:00Z", 0.0), ("2026-09-07T00:00:00Z", 50.0)]
        ).change("7d")
        assert change is not None and change.percent == 0.0

    def test_every_period_the_product_has_is_a_window(self):
        # The tool's schema is this alias; a period with no width would widen
        # silently to the whole series.
        assert set(WINDOW_MS) == {"1h", "24h", "7d", "30d", "all"}
