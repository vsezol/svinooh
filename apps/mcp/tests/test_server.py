from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx
import httpx2
from mcp import ClientSession
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
        self.refused = refused
        self.missing = missing

    async def me(self, token):
        self.tokens.append(token)
        if self.refused:
            raise UnknownTokenError
        return Me(user_id="u1", portfolios=(PortfolioRef(slug="main", name="Main"),))

    async def portfolio(self, ref, token):
        self.tokens.append(token)
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
