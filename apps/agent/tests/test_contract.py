"""Does the real API still send what our fixtures claim it sends?

This is the answer to "then let's test against the database instead": we do
both, and each answers a different question.

Every other test runs on hand-built fixtures, because a test that reads live
positions fails when a price moves, when a wallet gains a token, when a
protocol renames itself — noise that says nothing about our code, on a suite
that has to be trusted at three in the morning. Those tests answer "does the
code do the right thing with data of this shape".

This one answers the other half: "is that still the shape". It calls the live
API and checks that every field the agent reads is present and typed as the
fixtures declare — so a change to the DTO fails here, loudly, once, instead of
turning into a quietly wrong answer in a chat.

It needs the network, so it is opt-in:

    AGENT_CONTRACT_API=https://api-production-…/api python -m pytest -m contract

Point it at a public portfolio (AGENT_CONTRACT_PORTFOLIO) or let it create an
anonymous one from a public address.
"""
import os

import httpx
import pytest

from tests import fixtures as fx

pytestmark = pytest.mark.contract

API = os.getenv("AGENT_CONTRACT_API", "")
PORTFOLIO = os.getenv("AGENT_CONTRACT_PORTFOLIO", "")
PUBLIC_ADDRESS = os.getenv("AGENT_CONTRACT_ADDRESS", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")

pytest.importorskip("httpx")
if not API:
    pytest.skip("set AGENT_CONTRACT_API to run the contract tests", allow_module_level=True)


@pytest.fixture(scope="module")
def live_portfolio() -> dict:
    """A real portfolio from the real API — created if none was named."""
    with httpx.Client(base_url=API, timeout=60) as client:
        slug = PORTFOLIO
        if not slug:
            created = client.post("/portfolios/anonymous", json={"address": PUBLIC_ADDRESS})
            created.raise_for_status()
            slug = created.json()["slug"]
        answer = client.get(f"/portfolios/{slug}")
        answer.raise_for_status()
        return answer.json()


def types_of(sample: dict) -> dict[str, type | None]:
    """Field name to type, with None where the sample carries no value."""
    return {key: (type(value) if value is not None else None) for key, value in sample.items()}


class TestPortfolioShape:
    def test_the_fields_the_agent_reads_are_all_there(self, live_portfolio):
        assert set(fx.portfolio([])) <= set(live_portfolio), "portfolio lost a field we read"

    def test_a_wallet_still_looks_like_a_wallet(self, live_portfolio):
        wallets = live_portfolio.get("wallets")
        assert wallets, "a scanned portfolio with no wallets means the shape moved"
        ours = set(fx.wallet("0xabc", [fx.ETH]))
        assert ours <= set(wallets[0]), f"wallet lost: {ours - set(wallets[0])}"

    def test_a_position_still_carries_every_field_we_render(self, live_portfolio):
        positions = [p for w in live_portfolio["wallets"] for p in (w.get("positions") or [])]
        assert positions, "no positions to check the shape of"
        ours = set(fx.position("X", 1.0))
        missing = ours - set(positions[0])
        assert not missing, f"position lost: {missing}"

    @pytest.mark.parametrize("field,expected", [
        ("valueUsd", (int, float)),
        ("symbol", str),
        ("network", str),
        ("platform", str),
        ("category", str),
    ])
    def test_the_fields_we_group_by_keep_their_types(self, live_portfolio, field, expected):
        # Grouping on a field that turned into a dict would produce a
        # breakdown of nonsense rather than an error.
        values = [p[field] for w in live_portfolio["wallets"] for p in (w.get("positions") or [])
                  if p.get(field) is not None]
        assert values, f"nothing carries {field} any more"
        assert all(isinstance(v, expected) for v in values)

    def test_the_agent_can_read_it_at_all(self, live_portfolio):
        # The whole point, end to end: real data through the real renderer.
        from app.agent.context import portfolio_context

        block = portfolio_context(live_portfolio)
        assert "By network" in block and "position(s)" in block


class TestHistoryShape:
    def test_history_points_are_a_time_and_a_total(self, live_portfolio):
        with httpx.Client(base_url=API, timeout=60) as client:
            answer = client.get(f"/portfolios/{live_portfolio['slug']}/history", params={"range": "7d"})
            answer.raise_for_status()
            series = answer.json()
        assert set(fx.history([])) <= set(series)
        points = series.get("points") or []
        if points:
            assert set(fx.history([("t", 1.0)])["points"][0]) <= set(points[0])

    def test_the_window_slice_reads_the_timestamps_it_is_given(self, live_portfolio):
        # window_of parses `t`; a format change would silently widen every
        # period back to the whole series.
        from app.agent.tools import _epoch_ms

        with httpx.Client(base_url=API, timeout=60) as client:
            series = client.get(f"/portfolios/{live_portfolio['slug']}/history",
                                params={"range": "7d"}).json()
        points = series.get("points") or []
        if not points:
            pytest.skip("no history recorded yet for this portfolio")
        assert _epoch_ms(points[0]) is not None, "timestamps stopped parsing"
