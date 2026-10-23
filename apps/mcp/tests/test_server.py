from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import httpx2
import pytest
from mcp import ClientSession, MCPError
from mcp.client.streamable_http import streamable_http_client
from svinooh_portfolio.portfolio import (
    History,
    Me,
    Portfolio,
    PortfolioRef,
    Position,
    Reading,
    Wallet,
)
from svinooh_portfolio.source import UnknownTokenError

from app.server import create_app

PORTFOLIO = Portfolio(
    slug="main",
    total_usd=3_000.0,
    wallets=(
        Wallet(
            address="0xabc",
            chain="evm",
            status="ok",
            total_usd=3_000.0,
            positions=(Position(symbol="ETH", value_usd=3_000.0, amount=1.0, network="eth"),),
        ),
    ),
)


class Host:
    def __init__(self, *, refused=False, missing=False):
        self.tokens = []
        self.tracked = []
        self.read = []
        self.refused = refused
        self.missing = missing

    async def me(self, token):
        self.tokens.append(token)
        if self.refused:
            raise UnknownTokenError
        return Me(user_id="u1", portfolios=(PortfolioRef(slug="main", name="Main"),))

    async def create_anonymous_portfolio(self, address):
        self.tracked.append(address)
        return "anon-1"

    async def portfolio(self, ref, token):
        self.tokens.append(token)
        self.read.append(ref)
        if self.missing:
            response = httpx.Response(
                404,
                json={"statusCode": 404, "message": "Portfolio not found"},
                request=httpx.Request("GET", f"http://api/api/portfolios/{ref}"),
            )
            raise httpx.HTTPStatusError("404", request=response.request, response=response)
        return PORTFOLIO

    async def history(self, ref, range_, token):
        self.tokens.append(token)
        self.read.append(ref)
        return History(
            range=range_,
            readings=(
                Reading(at="2026-09-01T00:00:00Z", usd=100.0, epoch_ms=1_756_684_800_000),
                Reading(at="2026-09-07T00:00:00Z", usd=125.0, epoch_ms=1_757_203_200_000),
            ),
        )


@asynccontextmanager
async def connected(host: Host, token: str | None = None) -> AsyncIterator[ClientSession]:
    app = create_app(host)
    http = httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app),
        headers={"authorization": token} if token else None,
    )
    async with (
        app.state.mcp.session_manager.run(),
        http,
        streamable_http_client("http://mcp/mcp", http_client=http) as (read, write),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        yield session


async def called(session: ClientSession, name: str, **args) -> tuple[bool, str]:
    result = await session.call_tool(name, args)
    return result.is_error, "\n".join(part.text for part in result.content if part.type == "text")


class TestTheServer:
    async def test_offers_the_reading_tools_each_described(self):
        async with connected(Host()) as session:
            tools = (await session.list_tools()).tools
        assert {tool.name for tool in tools} == {
            "my_portfolios",
            "portfolio_overview",
            "position_details",
            "asset_breakdown",
            "history_summary",
            "calculate",
        }
        assert all(tool.description for tool in tools)

    async def test_every_tool_says_it_only_reads(self):
        async with connected(Host()) as session:
            tools = (await session.list_tools()).tools
        assert all(tool.annotations and tool.annotations.read_only_hint for tool in tools)
        assert all(tool.title for tool in tools)

    async def test_offers_the_scenarios_a_person_starts(self):
        async with connected(Host()) as session:
            prompts = {p.name: p for p in (await session.list_prompts()).prompts}
            asked = await session.get_prompt("risk_check", {"portfolio": "main"})
        assert set(prompts) == {"weekly_review", "risk_check", "explain_position", "compare"}
        assert [a.name for a in prompts["compare"].arguments or []] == ["first", "second"]
        text = asked.messages[0].content
        assert text.type == "text"
        assert "Check main," in text.text
        assert asked.messages[0].role == "user"

    async def test_a_portfolio_can_be_attached_as_context(self):
        host = Host()
        async with connected(host, "Bearer T") as session:
            templates = (await session.list_resource_templates()).resource_templates
            overview = await session.read_resource("svinooh://portfolio/main")
            assets = await session.read_resource("svinooh://portfolio/main/assets")
        assert {t.uri_template for t in templates} == {
            "svinooh://portfolio/{portfolio}",
            "svinooh://portfolio/{portfolio}/assets",
        }
        assert overview.contents[0].text.startswith('Portfolio "main"')
        assert "Counted total $3,000.00" in assets.contents[0].text
        assert host.tokens == ["Bearer T", "Bearer T"]

    async def test_a_missing_portfolio_is_refused_in_the_hosts_words(self):
        async with connected(Host(missing=True), "Bearer T") as session:
            with pytest.raises(MCPError, match="Portfolio not found"):
                await session.read_resource("svinooh://portfolio/nope")

    async def test_a_wallet_address_opens_as_the_landing_opens_it(self):
        host = Host()
        address = "0x" + "ab" * 20
        async with connected(host) as session:
            failed, text = await called(session, "portfolio_overview", portfolio=address)
            history = await called(session, "history_summary", portfolio=address, period="7d")
        assert not failed
        assert text.startswith('Portfolio "main"')
        assert host.tracked == [address, address]
        assert host.read == ["anon-1", "anon-1"]
        assert not history[0]

    async def test_a_portfolio_id_is_read_as_it_is(self):
        host = Host()
        async with connected(host) as session:
            await called(session, "asset_breakdown", portfolio="peaceful-breezy-lynx")
        assert host.tracked == []
        assert host.read == ["peaceful-breezy-lynx"]

    async def test_reads_with_the_callers_own_token(self):
        host = Host()
        async with connected(host, "Bearer T") as session:
            failed, text = await called(session, "position_details", portfolio="main", query="eth")
        assert not failed and "match" in text
        assert host.tokens == ["Bearer T"]

    async def test_without_a_token_reads_as_nobody(self):
        host = Host()
        async with connected(host) as session:
            _, owned = await called(session, "my_portfolios")
            await called(session, "portfolio_overview", portfolio="public-one")
        assert owned.startswith("Not signed in")
        assert host.tokens == [None]

    async def test_lists_what_the_caller_owns(self):
        async with connected(Host(), "Bearer T") as session:
            _, owned = await called(session, "my_portfolios")
        assert owned == "- Main (id main)"

    async def test_a_refused_token_is_said_plainly(self):
        async with connected(Host(refused=True), "Bearer old") as session:
            failed, text = await called(session, "my_portfolios")
        assert failed and "refused" in text

    async def test_the_hosts_own_reason_reaches_the_caller(self):
        async with connected(Host(missing=True), "Bearer T") as session:
            failed, text = await called(session, "asset_breakdown", portfolio="nope")
        assert failed and "Portfolio not found" in text
        assert "http://api" not in text

    async def test_the_overview_lists_as_many_positions_as_asked(self):
        async with connected(Host(), "Bearer T") as session:
            _, one = await called(session, "portfolio_overview", portfolio="main", positions=1)
            failed, _ = await called(session, "portfolio_overview", portfolio="main", positions=0)
        assert "ETH: $3,000.00" in one
        assert failed, "fewer than one is refused"

    async def test_history_is_summarized_for_the_asked_period(self):
        async with connected(Host(), "Bearer T") as session:
            _, text = await called(session, "history_summary", portfolio="main", period="7d")
        assert "+25.0%" in text

    async def test_answers_its_health_check(self):
        app = create_app(Host())
        async with httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="http://mcp"
        ) as client:
            assert (await client.get("/health")).json() == {"ok": True}
