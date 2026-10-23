from svinooh_portfolio import wire
from svinooh_portfolio.portfolio import WINDOW_MS
from svinooh_portfolio.reading import MAX_MATCHES, calculated, find_positions, summarize_history

from app.agent.tools import (
    NOTHING_CAME_BACK,
    asking_tools,
    math_tools,
    portfolio_tools,
    run_tools,
    tool_phrase,
)
from app.domain.house import plain
from tests import fixtures as fx

WEEK = [
    ("2026-07-28T12:00:00Z", 60_000.00),
    ("2026-08-20T12:00:00Z", 70_000.00),
    ("2026-08-31T20:00:00Z", 84_657.50),
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
        out = summarize_history(fx.as_history(WEEK), "1h")
        assert "5 readings" in out

    def test_too_little_history_says_so_rather_than_dividing_by_nothing(self):
        out = summarize_history(fx.as_history([("2026-09-07T18:00:00Z", 100.0)]), "7d")
        assert "Not enough history" in out

    def test_unreadable_and_missing_values_are_skipped(self):
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
        tools = portfolio_tools(FakeSource(), "my-pf", "Bearer T", fx.as_portfolio())
        schema = tools[0].args_schema.model_json_schema()
        assert set(schema["properties"]["period"]["enum"]) == set(WINDOW_MS)

    async def test_history_tool_carries_the_callers_slug_and_token(self):
        source = FakeSource()
        tools = portfolio_tools(source, "my-pf", "Bearer T", fx.as_portfolio())
        out = await tools[0].ainvoke({"period": "7d"})
        assert source.calls == [("my-pf", "7d", "Bearer T")]
        assert "$84,657.50" in out

    async def test_every_tool_is_offered_with_instructions_for_the_model(self):
        tools = portfolio_tools(FakeSource(), "p", "t", fx.as_portfolio())
        assert [t.name for t in tools] == ["history_summary", "position_details", "asset_breakdown"]
        assert all(t.description for t in tools)

    async def test_a_failing_tool_returns_its_error_to_the_model(self):
        tools = portfolio_tools(FakeSource(fail=True), "p", "t", fx.as_portfolio())
        messages = await run_tools(
            [{"name": "history_summary", "args": {"period": "7d"}, "id": "c1"}], tools
        )
        assert "failed" in messages[0].content and messages[0].tool_call_id == "c1"

    async def test_a_failure_says_what_it_means_rather_than_only_what_broke(self):
        tools = portfolio_tools(FakeSource(fail=True), "p", "t", fx.as_portfolio())
        messages = await run_tools(
            [{"name": "history_summary", "args": {"period": "7d"}, "id": "c1"}], tools
        )
        assert NOTHING_CAME_BACK in messages[0].content

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
    def test_a_period_is_said_the_way_somebody_would_say_it(self):
        said = tool_phrase("history_summary", {"period": "7d"})
        assert said == "Reading the total over the last 7 days"
        assert tool_phrase("history_summary", {"period": "1h"}).endswith("the last hour")

    def test_a_lookup_names_what_is_being_looked_up(self):
        assert tool_phrase("position_details", {"query": "aave"}) == "Reading positions · aave"

    def test_no_two_periods_read_the_same(self):
        said = [
            tool_phrase("history_summary", {"period": p}) for p in ("1h", "24h", "7d", "30d", "all")
        ]
        assert len(set(said)) == len(said)
        assert all(s is not None for s in said)

    def test_a_tool_with_no_phrase_says_nothing_rather_than_something_wrong(self):
        assert tool_phrase("some_new_tool", {"x": 1}) is None

    def test_an_argument_outside_the_known_set_falls_back_too(self):
        assert tool_phrase("history_summary", {"period": "3y"}) is None
        assert tool_phrase("position_details", {"query": "  "}) is None


class TestAskingInsteadOfGuessing:
    def setup_method(self):
        self.asked: list = []
        self.ask = asking_tools(self.asked)[0]

    def call(self, **over):
        asked = {
            "header": "Token",
            "question": "Which one do we place?",
            "options": ["USDC 12.00", "SOL 0.009"],
        }
        return self.ask.invoke({**asked, **over})

    def test_a_question_with_answers_reaches_the_user(self):
        said = self.call()
        assert len(self.asked) == 1
        chosen = self.asked[0]
        assert chosen.header == "Token"
        assert chosen.options == ("USDC 12.00", "SOL 0.009")
        assert "wait for the answer" in said

    def test_one_answer_is_not_a_choice(self):
        said = self.call(options=["USDC 12.00"])
        assert not self.asked
        assert "between 2 and 4" in said

    def test_neither_is_a_wall_of_them(self):
        said = self.call(options=["a", "b", "c", "d", "e"])
        assert not self.asked
        assert "between 2 and 4" in said

    def test_a_question_with_no_words_is_refused(self):
        said = self.call(question="  ")
        assert not self.asked
        assert "not a question" in said

    def test_the_model_is_told_to_ask_only_for_what_it_cannot_read(self):
        told = " ".join(self.ask.description.split())
        assert "instead of guessing" in told
        assert "a token they already named is not a question" in told


class TestNoEmojiSurvivesTheDoor:
    def test_a_picture_is_taken_out_of_what_the_model_wrote(self):
        assert plain("Выбирай ниже 👇") == "Выбирай ниже "
        assert plain("риск 🟢 низкий") == "риск  низкий"

    def test_the_words_and_their_spaces_are_left_alone(self):
        said = "Impermanent loss is a drop against holding."
        assert plain(said) == said

    def test_a_question_comes_through_without_them(self):
        asked: list = []
        ask = asking_tools(asked)[0]
        ask.invoke(
            {
                "header": "Токен 🪙",
                "question": "Что размещаем? 👇",
                "options": ["USDC 12.00 💵", "SOL 0.009"],
            }
        )
        chosen = asked[0]
        assert chosen.header == "Токен"
        assert chosen.question == "Что размещаем?"
        assert chosen.options == ("USDC 12.00", "SOL 0.009")

    def test_the_model_is_told_to_name_the_choice_in_their_language(self):
        told = " ".join(asking_tools([])[0].description.split())
        assert "in the user's own language" in told
        assert '"pick one below" says nothing' in told, "no chatter above the buttons"


def breakdown(*positions: dict) -> str:
    portfolio = fx.as_portfolio(fx.portfolio([fx.wallet(fx.EVM_ADDRESS, list(positions))]))
    tools = portfolio_tools(None, portfolio.slug, None, portfolio)
    return next(t for t in tools if t.name == "asset_breakdown").invoke({})


class TestAssetBreakdown:
    def test_the_stablecoin_half_of_a_pool_counts_as_stablecoins(self):
        out = breakdown(fx.UNISWAP)
        assert "Stablecoins: $1,676.00 held, $0.00 owed, $1,676.00 net — 46.56%" in out
        assert "Volatile assets: $1,924.00 held" in out

    def test_a_stablecoin_debt_is_subtracted_where_it_belongs(self):
        out = breakdown(fx.AAVE)
        assert "Stablecoins: $0.00 held, $5,200.00 owed, -$5,200.00 net" in out
        assert "Volatile assets: $12,500.00 held, $0.00 owed, $12,500.00 net" in out
        assert "Counted total $7,300.00" in out

    def test_a_vault_named_by_its_stablecoin_counts_without_legs(self):
        vault = fx.position("sUSDe", 1_000.0, platform="ethena", category="defi")
        assert "Stablecoins: $1,000.00 held" in breakdown(vault, fx.ETH)

    def test_a_position_with_unknown_contents_is_in_neither_figure(self):
        pool = fx.position(
            "UNI-V3",
            500.0,
            name="Uniswap V3 (Liquidity Pool)",
            platform="uniswap3",
            category="defi",
        )
        out = breakdown(pool, fx.ETH)
        assert "Volatile assets: $16,683.65 held" in out
        assert "in neither figure above: $500.00" in out
        assert "UNI-V3 (Uniswap V3 (Liquidity Pool)) on eth $500.00" in out

    def test_the_token_list_is_net_of_debt(self):
        out = breakdown(fx.AAVE, fx.UNISWAP)
        assert "USDC -$3,524.00" in out


class TestCalculate:
    def test_answers_exactly(self):
        assert calculated("0.1 + 0.2") == "0.1 + 0.2 = 0.3 (rounded to cents: 0.30)"

    def test_a_share_is_rounded_for_reading_and_kept_exact(self):
        out = calculated("21327.72 / 85109.6 * 100")
        assert "= 25.0591237651" in out and "rounded to cents: 25.06" in out

    def test_says_it_could_not_rather_than_guessing(self):
        assert calculated("1 / 0").startswith("Could not calculate")
        assert calculated("open('x')").startswith("Could not calculate")

    def test_is_offered_as_a_tool(self):
        assert [t.name for t in math_tools()] == ["calculate"]
        assert tool_phrase("calculate", {"expression": "1+1"}) == "Calculating"
