"""Where money can be put to work: the band, the mapping and the wording.

The risk band is the only opinion this service has about somebody else's
product, so it is pinned line by line — including what it says WHY, because a
band with no reason behind it is a number pretending to be advice.
"""

from datetime import UTC, datetime
from decimal import Decimal

import httpx
import pytest

from app.adapters.earn import EarnApiSource
from app.agent.tools import describe_pools, earn_tools, tool_phrase
from app.domain.earn import CatalogSnapshot, YieldPool

CURATED = {
    "id": "sol:kamino:vault:AAA",
    "network": "sol",
    "protocol": "kamino",
    "kind": "vault",
    "name": "Steakhouse USDC",
    "token": {"symbol": "USDC", "mint": "EPjF…", "decimals": 6},
    "apy": {"net": "0.1148", "base": "0.0707", "rewards": "0", "incentives": "0.0441"},
    "tvl_usd": "42000000.12",
    "url": "https://kamino.com/earn/lend/AAA",
}


def pool(**over) -> YieldPool:
    base = {
        "id": "sol:kamino:vault:AAA",
        "name": "Steakhouse USDC",
        "protocol": "kamino",
        "kind": "vault",
        "token": "USDC",
        "apy_net": Decimal("0.0512"),
        "apy_base": Decimal("0.0480"),
        "apy_rewards": Decimal("0.0032"),
        "apy_incentives": Decimal("0"),
        "tvl_usd": Decimal("42000000"),
        "url": "https://kamino.com/earn/lend/AAA",
    }
    return YieldPool(**{**base, **over})


class TestTheBand:
    def test_a_big_curated_vault_paid_by_borrowers_is_the_safe_end(self):
        assert pool().risk == "low"
        assert pool().risk_reasons == ()

    def test_a_single_market_reserve_is_one_step_out(self):
        reserve = pool(kind="reserve")
        assert reserve.risk == "medium"
        assert "one market's reserve" in reserve.risk_reasons[0]

    def test_a_thin_pool_is_said_to_be_thin(self):
        thin = pool(tvl_usd=Decimal("900000"))
        assert thin.risk == "medium"
        assert "under $5M" in thin.risk_reasons[0]

    def test_a_rate_that_is_mostly_a_programme_says_the_programme_ends(self):
        farmed = pool(
            apy_base=Decimal("0.01"), apy_rewards=Decimal("0.09"), apy_net=Decimal("0.10")
        )
        assert farmed.risk == "medium"
        assert "ends" in farmed.risk_reasons[0]

    def test_incentives_count_as_a_programme_too(self):
        # The pool that made this obvious: 7.07% from borrowers, 4.41% from
        # incentives, rewards at zero. Reading only `rewards` called that a
        # borrower-paid rate, which is the one reading that flatters it.
        mostly = pool(
            apy_base=Decimal("0.01"),
            apy_rewards=Decimal("0"),
            apy_incentives=Decimal("0.09"),
            apy_net=Decimal("0.10"),
        )
        assert mostly.risk == "medium" and "ends" in mostly.risk_reasons[0]

    def test_two_marks_or_more_is_the_far_end(self):
        assert pool(kind="reserve", tvl_usd=Decimal("1000")).risk == "high"

    def test_a_pool_paying_nothing_is_not_a_division_by_zero(self):
        assert pool(apy_net=Decimal(0), apy_base=Decimal(0), apy_rewards=Decimal(0)).risk == "low"


class TestReadingTheCatalog:
    @pytest.mark.anyio
    async def test_strings_on_the_wire_become_numbers_here(self):
        catalog = _source({"data": [CURATED], "meta": {"as_of": "2026-09-18T12:00:00Z"}})
        snapshot = await catalog.best_pools("USDC", 8)
        assert snapshot.pools[0].apy_net == Decimal("0.1148")
        assert snapshot.pools[0].apy_incentives == Decimal("0.0441")
        assert snapshot.pools[0].tvl_usd == Decimal("42000000.12")
        assert snapshot.as_of == datetime(2026, 9, 18, 12, 0, tzinfo=UTC)

    @pytest.mark.anyio
    async def test_the_ticker_and_the_ranking_are_asked_for_at_the_source(self):
        seen: dict = {}
        catalog = _source({"data": [], "meta": {}}, seen)
        await catalog.best_pools("USDC", 8)
        assert seen["params"] == {"sort": "-apy", "limit": "8", "token": "USDC"}

    @pytest.mark.anyio
    async def test_an_unreadable_rate_is_zero_rather_than_a_failed_turn(self):
        broken = {**CURATED, "apy": {**CURATED["apy"], "net": "n/a"}}
        snapshot = await _source({"data": [broken], "meta": {}}).best_pools(None, 8)
        assert snapshot.pools[0].apy_net == Decimal(0)

    @pytest.mark.anyio
    async def test_a_catalog_that_could_not_refresh_says_so(self):
        snapshot = await _source({"data": [CURATED], "meta": {"stale": True}}).best_pools(None, 8)
        assert snapshot.stale is True


class TestWhatTheModelReads:
    def test_a_line_carries_the_rate_its_split_the_size_and_the_band(self):
        out = describe_pools(CatalogSnapshot(pools=(pool(),)), "USDC")
        assert "5.12% net on USDC" in out
        assert "4.80% base + 0.32% rewards" in out
        assert "incentives" not in out, "a part that pays nothing is not mentioned"
        assert "$42.0M deposited" in out
        assert "Risk low" in out

    def test_the_reason_travels_with_the_band(self):
        out = describe_pools(CatalogSnapshot(pools=(pool(kind="reserve"),)), "USDC")
        assert "Risk medium: one market's reserve" in out

    def test_every_part_of_the_rate_that_pays_is_named(self):
        out = describe_pools(
            CatalogSnapshot(pools=(pool(apy_incentives=Decimal("0.0441")),)), "USDC"
        )
        assert "4.80% base + 0.32% rewards + 4.41% incentives" in out

    def test_the_id_is_there_because_a_deposit_will_need_it(self):
        assert "id sol:kamino:vault:AAA" in describe_pools(CatalogSnapshot(pools=(pool(),)), "")

    def test_an_empty_catalog_is_said_plainly_and_nothing_is_substituted(self):
        out = describe_pools(CatalogSnapshot(pools=()), "PYUSD")
        assert "nothing for PYUSD" in out and "do not" in out

    def test_a_stale_catalog_warns_the_answer_that_quotes_it(self):
        out = describe_pools(CatalogSnapshot(pools=(pool(),), stale=True), "")
        assert "older than usual" in out

    @pytest.mark.anyio
    async def test_the_tool_upper_cases_the_ticker_the_model_typed(self):
        asked: list = []

        class Shelf:
            async def best_pools(self, token, limit):
                asked.append((token, limit))
                return CatalogSnapshot(pools=(pool(),))

        (tool,) = earn_tools(Shelf())
        await tool.ainvoke({"token": " usdc "})
        assert asked == [("USDC", 8)]

    @pytest.mark.anyio
    async def test_no_ticker_means_every_token(self):
        asked: list = []

        class Shelf:
            async def best_pools(self, token, limit):
                asked.append(token)
                return CatalogSnapshot(pools=(pool(),))

        (tool,) = earn_tools(Shelf())
        await tool.ainvoke({"token": ""})
        assert asked == [None]

    def test_the_trace_says_what_it_went_looking_for(self):
        assert tool_phrase("earn_options", {"token": "usdc"}) == "Reading where USDC can earn"
        assert tool_phrase("earn_options", {}) == "Reading where money can earn"


def _source(payload: dict, seen: dict | None = None) -> EarnApiSource:
    """The adapter over a transport that answers with this payload."""

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen["params"] = dict(request.url.params)
        return httpx.Response(200, json=payload)

    return EarnApiSource("http://earn", httpx.AsyncClient(transport=httpx.MockTransport(handler)))
