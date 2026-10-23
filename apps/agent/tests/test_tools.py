from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import pytest
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from svinooh_portfolio.portfolio import WINDOW_MS, Period

from app.adapters.mcp import McpTools
from app.agent.tools import NOTHING_CAME_BACK, asking_tools, run_tools, tool_phrase
from app.domain.house import plain


class Server:
    """A real MCP server with the svinooh tools' names and arguments, recording each call."""

    def __init__(self, fail: bool = False) -> None:
        self.calls: list[tuple[str, dict, str | None]] = []
        self.fail = fail
        self.mcp = FastMCP(
            "svinooh",
            stateless_http=True,
            json_response=True,
            transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
        )

        def heard(name: str, ctx: Context, **args) -> str:
            request = ctx.request_context.request
            token = request.headers.get("authorization") if request is not None else None
            self.calls.append((name, args, token))
            if self.fail:
                raise ToolError(f"{name} is down")
            return f"{name} read {args}"

        @self.mcp.tool()
        def history_summary(portfolio: str, period: Period, ctx: Context) -> str:
            """How the total moved."""
            return heard("history_summary", ctx, portfolio=portfolio, period=period)

        @self.mcp.tool()
        def position_details(portfolio: str, query: str, ctx: Context) -> str:
            """Positions matching a word."""
            return heard("position_details", ctx, portfolio=portfolio, query=query)

        @self.mcp.tool()
        def asset_breakdown(portfolio: str, ctx: Context) -> str:
            """What the money is in."""
            return heard("asset_breakdown", ctx, portfolio=portfolio)

        @self.mcp.tool()
        def calculate(expression: str, ctx: Context) -> str:
            """Exact arithmetic."""
            return heard("calculate", ctx, expression=expression)

        @self.mcp.tool()
        def portfolio_overview(portfolio: str, ctx: Context, positions: int = 12) -> str:
            """A portfolio as a whole."""
            return heard("portfolio_overview", ctx, portfolio=portfolio, positions=positions)

        @self.mcp.tool()
        def my_portfolios(ctx: Context) -> str:
            """The caller's portfolios."""
            return heard("my_portfolios", ctx)

        self.app = self.mcp.streamable_http_app()

    def client(self, **options) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), **options)


@asynccontextmanager
async def served(fail: bool = False) -> AsyncIterator[tuple[Server, McpTools]]:
    server = Server(fail)
    async with server.mcp.session_manager.run():
        yield server, McpTools("http://mcp/mcp", server.client)


class TestTheServersTools:
    async def test_the_model_chooses_the_period_never_the_portfolio(self):
        async with served() as (_, mcp):
            tools = await mcp.tools("Bearer T", "my-pf")
        history = next(t for t in tools if t.name == "history_summary")
        assert set(history.args_schema["properties"]) == {"period"}, "identity is not the model's"
        assert set(history.args_schema["properties"]["period"]["enum"]) == set(WINDOW_MS)

    async def test_every_call_reads_the_turns_portfolio_with_the_callers_token(self):
        async with served() as (server, mcp):
            tools = await mcp.tools("Bearer T", "my-pf")
            calls = [{"name": "asset_breakdown", "args": {"portfolio": "someone-else"}, "id": "c"}]
            await run_tools(calls, tools)
        assert server.calls == [("asset_breakdown", {"portfolio": "my-pf"}, "Bearer T")]

    async def test_the_agent_takes_only_what_answers_about_this_portfolio(self):
        async with served() as (_, mcp):
            tools = await mcp.tools("Bearer T", "my-pf")
        assert {t.name for t in tools} == {
            "history_summary",
            "position_details",
            "asset_breakdown",
            "calculate",
        }
        assert all(t.description for t in tools)

    async def test_without_a_portfolio_only_what_needs_none_is_offered(self):
        async with served() as (_, mcp):
            tools = await mcp.tools("Bearer T")
        assert [t.name for t in tools] == ["calculate"]

    async def test_the_overview_is_read_for_the_turns_portfolio(self):
        async with served() as (server, mcp):
            text = await mcp.overview("my-pf", None, 5)
        assert text.startswith("portfolio_overview read")
        asked = {"portfolio": "my-pf", "positions": 5}
        assert server.calls == [("portfolio_overview", asked, None)]

    async def test_a_refusal_from_the_server_is_raised_not_read_as_an_answer(self):
        async with served(fail=True) as (_, mcp):
            with pytest.raises(RuntimeError, match="portfolio_overview is down"):
                await mcp.overview("my-pf", "Bearer T", 12)

    async def test_a_failing_tool_tells_the_model_nothing_came_back(self):
        async with served(fail=True) as (_, mcp):
            tools = await mcp.tools("Bearer T", "my-pf")
            messages = await run_tools(
                [{"name": "history_summary", "args": {"period": "7d"}, "id": "c1"}], tools
            )
        assert "history_summary is down" in messages[0].content
        assert NOTHING_CAME_BACK in messages[0].content
        assert messages[0].tool_call_id == "c1"

    async def test_the_model_reads_the_servers_text_not_its_envelope(self):
        async with served() as (_, mcp):
            tools = await mcp.tools("Bearer T", "my-pf")
            calls = [{"name": "calculate", "args": {"expression": "1+1"}, "id": "c"}]
            messages = await run_tools(calls, tools)
        assert messages[0].content == "calculate read {'expression': '1+1'}"

    async def test_an_unknown_tool_is_reported_not_raised(self):
        messages = await run_tools([{"name": "nope", "args": {}, "id": "c9"}], [])
        assert "unknown tool" in messages[0].content

    async def test_every_call_gets_exactly_one_answer(self):
        async with served() as (_, mcp):
            tools = await mcp.tools("Bearer T", "my-pf")
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
