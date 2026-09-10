"""The methods the model actually calls.

A tool is the one place where a wrong number becomes a confident sentence, so
every branch of every tool is pinned here — including the ones that are only
reached when something is missing or refused.
"""

from app.adapters import wire
from app.agent.tools import (
    MAX_MATCHES,
    find_positions,
    portfolio_tools,
    run_tools,
    summarize_history,
    tool_phrase,
)
from app.domain.portfolio import WINDOW_MS
from tests import fixtures as fx

# A week of readings, oldest first, with the series reaching back further than
# the window — which is exactly how the API answers.
WEEK = [
    ("2026-07-28T12:00:00Z", 60_000.00),  # six weeks back: inside the series, outside the week
    ("2026-08-20T12:00:00Z", 70_000.00),
    ("2026-08-31T20:00:00Z", 84_657.50),  # the week opens here
    ("2026-09-03T12:00:00Z", 82_247.82),
    ("2026-09-07T18:00:00Z", 83_560.55),
]


class TestHistory:
    def test_measures_the_asked_for_window_not_the_whole_series(self):
        out = summarize_history(fx.as_history(WEEK), "7d")
        assert "$84,657.50" in out, "the week starts at its first reading"
        assert "$60,000.00" not in out, "a six-week-old point is not last Monday"

    def test_change_is_computed_over_that_window(self):
        out = summarize_history(fx.as_history(WEEK), "7d")
        assert "-1,096.95 USD" in out and "-1.3%" in out

    def test_reports_the_low_and_the_high_of_the_window(self):
        out = summarize_history(fx.as_history(WEEK), "7d")
        assert "Low $82,247.82" in out and "high $84,657.50" in out

    def test_says_the_last_reading_is_not_the_live_total(self):
        assert "behind the live total" in summarize_history(fx.as_history(WEEK), "7d")

    def test_all_has_no_window_to_slice(self):
        out = summarize_history(fx.as_history(WEEK, "all"), "all")
        assert "$60,000.00" in out, "'all' means all of it"

    def test_a_window_with_one_reading_falls_back_to_the_series(self):
        # Nothing inside the hour: better a true statement about a longer span
        # than a made-up one about this one.
        out = summarize_history(fx.as_history(WEEK), "1h")
        assert "5 readings" in out

    def test_too_little_history_says_so_rather_than_dividing_by_nothing(self):
        out = summarize_history(fx.as_history([("2026-09-07T18:00:00Z", 100.0)]), "7d")
        assert "Not enough history" in out

    def test_unreadable_and_missing_values_are_skipped(self):
        # A reading with no total is dropped by the mapper; one whose
        # timestamp cannot be placed in time is outside every window.
        series = wire.history(
            {
                "points": [
                    {"t": "2026-09-01T00:00:00Z", "usd": None},
                    {"t": "not-a-date", "usd": 10.0},
                    {"t": "2026-09-05T00:00:00Z", "usd": 100.0},
                    {"t": "2026-09-07T00:00:00Z", "usd": 110.0},
                ]
            }
        )
        out = summarize_history(series, "7d")
        assert "+10.00 USD" in out and "n/a" not in out

    def test_a_zero_start_does_not_divide_by_zero(self):
        out = summarize_history(
            fx.as_history([("2026-09-06T00:00:00Z", 0.0), ("2026-09-07T00:00:00Z", 50.0)]), "7d"
        )
        assert "+0.0%" in out

    def test_a_window_keeps_order_and_bounds(self):
        series = fx.as_history(WEEK)
        assert series.window("30d").readings[0].usd == 70_000.00
        assert series.window("all").readings == series.readings


class TestSearch:
    def test_finds_a_pool_by_its_protocol_not_its_symbol(self):
        out = find_positions(fx.as_portfolio(), "uniswap")
        assert out.startswith('1 position(s) match "uniswap", $3,600.00 in total')
        assert "cbBTC/USDC" in out

    def test_finds_by_network(self):
        assert '1 position(s) match "base"' in find_positions(fx.as_portfolio(), "base")

    def test_finds_by_category(self):
        out = find_positions(fx.as_portfolio(), "defi")
        assert out.startswith('2 position(s) match "defi", $16,200.00 in total')

    def test_is_case_insensitive(self):
        assert find_positions(fx.as_portfolio(), "UNISWAP").startswith("1 position")

    def test_shows_composition_so_a_pool_answer_has_its_legs(self):
        out = find_positions(fx.as_portfolio(), "aave")
        assert "borrow USDC $5,200.00" in out

    def test_searches_every_wallet(self):
        out = find_positions(fx.as_portfolio(fx.two_wallet_portfolio()), "sol")
        assert "1 position(s)" in out and "SOL" in out

    def test_a_headline_the_model_could_quote_is_the_right_number(self):
        # The tool's first line is a total, and a total that counted the
        # wrong positions is the one thing this file exists to prevent.
        held = fx.as_portfolio(
            fx.portfolio(
                [
                    fx.wallet(
                        fx.EVM_ADDRESS,
                        [
                            fx.position("Thena", 100.0, platform="bsc_thena"),
                            fx.position("Ethena", 900.0, platform="ethena"),
                        ],
                    )
                ]
            )
        )
        out = find_positions(held, "Thena")
        assert out.startswith('1 position(s) match "Thena", $100.00 in total')
        assert "Ethena" not in out

    def test_a_miss_names_the_protocols_that_are_there(self):
        out = find_positions(fx.as_portfolio(), "curve")
        assert "No position matches" in out and "uniswap3" in out and "aave3" in out

    def test_an_empty_query_is_refused_not_guessed(self):
        assert find_positions(fx.as_portfolio(), "   ") == "Empty query."

    def test_reports_the_full_total_even_when_the_list_is_capped(self):
        out = find_positions(fx.as_portfolio(tail=MAX_MATCHES + 10), "small")
        assert f"{MAX_MATCHES + 10} position(s) match" in out
        assert f"showing the largest {MAX_MATCHES}" in out
        assert len(out.splitlines()) == MAX_MATCHES + 1


class FakeSource:
    """The portfolio API, as the tools use it."""

    def __init__(self, series=None, fail=False):
        self.calls = []
        self.series = series or fx.as_history(WEEK)
        self.fail = fail

    async def history(self, ref, range_, token):
        self.calls.append((ref, range_, token))
        if self.fail:
            raise RuntimeError("history is down")
        return self.series


class TestToolWiring:
    def test_the_model_chooses_the_period_never_the_portfolio(self):
        tools = portfolio_tools(FakeSource(), "my-pf", "Bearer T", fx.as_portfolio())
        schema = tools[0].args_schema.model_json_schema()
        assert set(schema["properties"]) == {"period"}, "identity is not the model's to pass"

    def test_and_only_the_periods_the_product_has(self):
        # The tool's schema is the domain's Period alias, so the five the
        # charts use are the five the model may ask for.
        tools = portfolio_tools(FakeSource(), "my-pf", "Bearer T", fx.as_portfolio())
        schema = tools[0].args_schema.model_json_schema()
        assert set(schema["properties"]["period"]["enum"]) == set(WINDOW_MS)

    async def test_history_tool_carries_the_callers_slug_and_token(self):
        source = FakeSource()
        tools = portfolio_tools(source, "my-pf", "Bearer T", fx.as_portfolio())
        out = await tools[0].ainvoke({"period": "7d"})
        assert source.calls == [("my-pf", "7d", "Bearer T")]
        assert "$84,657.50" in out

    async def test_both_tools_are_offered_with_instructions_for_the_model(self):
        tools = portfolio_tools(FakeSource(), "p", "t", fx.as_portfolio())
        assert [t.name for t in tools] == ["history_summary", "position_details"]
        assert all(t.description for t in tools)

    async def test_a_failing_tool_returns_its_error_to_the_model(self):
        tools = portfolio_tools(FakeSource(fail=True), "p", "t", fx.as_portfolio())
        messages = await run_tools(
            [{"name": "history_summary", "args": {"period": "7d"}, "id": "c1"}], tools
        )
        assert "failed" in messages[0].content and messages[0].tool_call_id == "c1"

    async def test_an_unknown_tool_is_reported_not_raised(self):
        tools = portfolio_tools(FakeSource(), "p", "t", fx.as_portfolio())
        messages = await run_tools([{"name": "nope", "args": {}, "id": "c9"}], tools)
        assert "unknown tool" in messages[0].content

    async def test_every_call_gets_exactly_one_answer(self):
        tools = portfolio_tools(FakeSource(), "p", "t", fx.as_portfolio())
        calls = [
            {"name": "position_details", "args": {"query": "uniswap"}, "id": "a"},
            {"name": "history_summary", "args": {"period": "24h"}, "id": "b"},
        ]
        messages = await run_tools(calls, tools)
        assert [m.tool_call_id for m in messages] == ["a", "b"]


class TestHowACallReadsToWhoeverAsked:
    """The trace is read by the person who asked the question, not by us."""

    def test_a_period_is_said_the_way_somebody_would_say_it(self):
        assert tool_phrase("history_summary", {"period": "7d"}) == "Reading the last 7 days"
        assert tool_phrase("history_summary", {"period": "1h"}) == "Reading the last hour"
        assert tool_phrase("history_summary", {"period": "all"}) == "Reading the whole history"

    def test_a_lookup_names_what_is_being_looked_up(self):
        assert tool_phrase("position_details", {"query": "aave"}) == "Looking up aave"

    def test_no_two_periods_read_the_same(self):
        # The whole point of the trace is that it can be checked against what
        # ran, so two different calls must not produce one sentence — that
        # would be worse than the function name it replaced.
        said = [
            tool_phrase("history_summary", {"period": p}) for p in ("1h", "24h", "7d", "30d", "all")
        ]
        assert len(set(said)) == len(said)
        assert all(s is not None for s in said)

    def test_a_tool_with_no_phrase_says_nothing_rather_than_something_wrong(self):
        # None sends run_tools back to the tool's own name and argument. A new
        # tool reports honestly on its first day instead of borrowing a
        # sentence written for a different one.
        assert tool_phrase("some_new_tool", {"x": 1}) is None

    def test_an_argument_outside_the_known_set_falls_back_too(self):
        assert tool_phrase("history_summary", {"period": "3y"}) is None
        assert tool_phrase("position_details", {"query": "  "}) is None
