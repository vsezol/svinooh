import asyncio
import base64
import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal

import httpx
import httpx2
import pytest
from mcp import ClientSession, MCPError
from mcp.client.streamable_http import streamable_http_client
from starlette.applications import Starlette
from svinooh_portfolio.pools import CatalogSnapshot, YieldPool
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

from app.server import create_anonymous_app, create_app
from app.store import MemoryStore

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


class Catalog:
    def __init__(self) -> None:
        self.asked: list[tuple[str | None, int]] = []

    async def best_pools(self, token, limit):
        self.asked.append((token, limit))
        pool = YieldPool(
            id="sol:kamino:vault:A1",
            name="Steakhouse USDC",
            protocol="kamino",
            kind="vault",
            network="sol",
            token="USDC",
            apy_net=Decimal("0.0512"),
            apy_base=Decimal("0.0412"),
            apy_rewards=Decimal("0.01"),
            apy_incentives=Decimal(0),
            tvl_usd=Decimal("88000000"),
            url="https://kamino.finance",
        )
        return CatalogSnapshot(pools=(pool,))


def session_token(exp: float | None = None) -> str:
    """A svinooh session the way the API issues one: a JWT, here unsigned, with an `exp`."""

    def part(data: dict) -> str:
        return base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")

    claims = {"sub": "u1", "exp": int(exp if exp is not None else time.time() + 3600)}
    return f"{part({'alg': 'HS256'})}.{part(claims)}.signature"


SESSION = f"Bearer {session_token()}"


def app_for(host: Host, catalog: Catalog | None = None) -> Starlette:
    return create_app(
        host, catalog or Catalog(), MemoryStore(), "http://localhost", "https://svinooh.com"
    )


@asynccontextmanager
async def connected(
    host: Host, token: str | None = None, catalog: Catalog | None = None
) -> AsyncIterator[ClientSession]:
    app = app_for(host, catalog) if token else create_anonymous_app(host, catalog or Catalog())
    http = httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app),
        headers={"authorization": token} if token else None,
    )
    endpoint = "http://localhost/mcp"
    async with (
        app.router.lifespan_context(app),
        http,
        streamable_http_client(endpoint, http_client=http) as (read, write),
        ClientSession(read, write) as session,
    ):
        await session.initialize()
        yield session


async def called(session: ClientSession, name: str, **args) -> tuple[bool, str]:
    result = await session.call_tool(name, args)
    return result.is_error, "\n".join(part.text for part in result.content if part.type == "text")


async def status_of_listening(app: Starlette, token: str | None = None) -> int:
    headers = {"accept": "text/event-stream"} | ({"authorization": token} if token else {})
    async with (
        asyncio.timeout(5),
        app.router.lifespan_context(app),
        httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="http://localhost"
        ) as client,
    ):
        return (await client.get("/mcp", headers=headers)).status_code


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
            "earn_options",
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
        assert set(prompts) == {
            "weekly_review",
            "risk_check",
            "explain_position",
            "compare",
            "where_to_earn",
        }
        assert [a.name for a in prompts["compare"].arguments or []] == ["first", "second"]
        text = asked.messages[0].content
        assert text.type == "text"
        assert "Check main," in text.text
        assert asked.messages[0].role == "user"

    async def test_a_portfolio_can_be_attached_as_context(self):
        host = Host()
        async with connected(host, SESSION) as session:
            templates = (await session.list_resource_templates()).resource_templates
            overview = await session.read_resource("svinooh://portfolio/main")
            assets = await session.read_resource("svinooh://portfolio/main/assets")
        assert {t.uri_template for t in templates} == {
            "svinooh://portfolio/{portfolio}",
            "svinooh://portfolio/{portfolio}/assets",
        }
        assert overview.contents[0].text.startswith('Portfolio "main"')
        assert "Counted total $3,000.00" in assets.contents[0].text
        assert host.tokens == [SESSION, SESSION]

    async def test_the_callers_own_portfolios_are_listed_to_attach(self):
        async with connected(Host(), SESSION) as session:
            listed = (await session.list_resources()).resources
            read = await session.read_resource(str(listed[0].uri))
        assert [str(r.uri) for r in listed] == [
            "svinooh://portfolio/main",
            "svinooh://portfolio/main/assets",
        ]
        assert listed[0].title == "Main: overview"
        assert read.contents[0].text.startswith('Portfolio "main"')

    async def test_nobody_is_listed_anybodys_portfolios(self):
        async with connected(Host()) as session:
            assert (await session.list_resources()).resources == []

    async def test_a_refused_token_lists_nothing_of_its_own(self):
        async with connected(Host(refused=True), SESSION) as session:
            assert (await session.list_resources()).resources == []

    async def test_a_missing_portfolio_is_refused_in_the_hosts_words(self):
        async with connected(Host(missing=True), SESSION) as session:
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

    async def test_the_best_rates_are_read_for_the_asked_token(self):
        async with connected(Host(), catalog=(catalog := Catalog())) as session:
            failed, text = await called(session, "earn_options", token=" usdc ")
        assert not failed
        assert "Steakhouse USDC (kamino vault) pays 5.12% net on USDC" in text
        assert catalog.asked == [("USDC", 8)]

    async def test_reads_with_the_callers_own_token(self):
        host = Host()
        async with connected(host, SESSION) as session:
            failed, text = await called(session, "position_details", portfolio="main", query="eth")
        assert not failed and "match" in text
        assert host.tokens == [SESSION]

    async def test_without_a_token_reads_as_nobody(self):
        host = Host()
        async with connected(host) as session:
            _, owned = await called(session, "my_portfolios")
            await called(session, "portfolio_overview", portfolio="public-one")
        assert owned.startswith("Not signed in")
        assert host.tokens == [None]

    async def test_lists_what_the_caller_owns(self):
        async with connected(Host(), SESSION) as session:
            _, owned = await called(session, "my_portfolios")
        assert owned == "- Main (id main)"

    async def test_a_refused_token_is_said_plainly(self):
        async with connected(Host(refused=True), f"Bearer {session_token()}") as session:
            failed, text = await called(session, "my_portfolios")
        assert failed and "refused" in text

    async def test_the_hosts_own_reason_reaches_the_caller(self):
        async with connected(Host(missing=True), SESSION) as session:
            failed, text = await called(session, "asset_breakdown", portfolio="nope")
        assert failed and "Portfolio not found" in text
        assert "http://api" not in text

    async def test_the_overview_lists_as_many_positions_as_asked(self):
        async with connected(Host(), SESSION) as session:
            _, one = await called(session, "portfolio_overview", portfolio="main", positions=1)
            failed, _ = await called(session, "portfolio_overview", portfolio="main", positions=0)
        assert "ETH: $3,000.00" in one
        assert failed, "fewer than one is refused"

    async def test_history_is_summarized_for_the_asked_period(self):
        async with connected(Host(), SESSION) as session:
            _, text = await called(session, "history_summary", portfolio="main", period="7d")
        assert "+25.0%" in text

    async def test_answers_its_health_check(self):
        app = app_for(Host())
        async with httpx2.AsyncClient(
            transport=httpx2.ASGITransport(app=app), base_url="http://localhost"
        ) as client:
            assert (await client.get("/health")).json() == {"ok": True}

    async def test_no_stream_is_held_open_for_the_anonymous(self):
        assert await status_of_listening(create_anonymous_app(Host(), Catalog())) == 405

    async def test_no_stream_is_held_open_for_the_signed_in(self):
        assert await status_of_listening(app_for(Host()), SESSION) == 405

    async def test_a_listen_without_a_token_is_still_told_to_sign_in(self):
        assert await status_of_listening(app_for(Host())) == 401
