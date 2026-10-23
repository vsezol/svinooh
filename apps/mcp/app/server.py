from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from pydantic import Field
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from svinooh_portfolio.portfolio import Period, exposure_of
from svinooh_portfolio.reading import (
    calculated,
    describe_exposure,
    find_positions,
    named_position,
    portfolio_context,
    summarize_history,
)
from svinooh_portfolio.source import DataSource, UnknownTokenError

MAX_POSITIONS = 12

INSTRUCTIONS = (
    "Read-only access to crypto portfolios tracked on svinooh.com. A portfolio is "
    "read by its id, the part of its link after /p/. With a svinooh token in the "
    "Authorization header the caller's own portfolios can be listed and read, "
    "private ones included; without one only public portfolios can be read. "
    "Figures are in USD as of each wallet's last scan."
)

PortfolioId = Annotated[
    str, Field(description="The portfolio's id: the part of its svinooh.com link after /p/.")
]


def build(source: DataSource) -> MCPServer:
    """The portfolio reading tools as an MCP server, acting with the caller's own token."""
    server = MCPServer("svinooh", instructions=INSTRUCTIONS)

    @server.tool()
    async def my_portfolios(ctx: Context) -> str:
        """The portfolios the signed-in caller owns, each with the id it is read by."""
        token = _token(ctx)
        if not token:
            return "Not signed in: only public portfolios can be read, by their id."
        try:
            owned = (await source.me(token)).portfolios
        except UnknownTokenError as error:
            raise ToolError("The svinooh token was refused; it may have expired.") from error
        if not owned:
            return "The caller owns no portfolios yet."
        return "\n".join(f"- {ref.name or ref.slug} (id {ref.slug})" for ref in owned)

    @server.tool()
    async def portfolio_overview(portfolio: PortfolioId, ctx: Context) -> str:
        """A portfolio as a whole: its total, where the money is by network, type and
        protocol, and every wallet with its largest positions.

        Read this first; the other tools go deeper into what it summarizes.
        """
        read = await _read(source.portfolio(portfolio, _token(ctx)))
        return portfolio_context(read, MAX_POSITIONS)

    @server.tool()
    async def position_details(portfolio: PortfolioId, query: str, ctx: Context) -> str:
        """Full detail on a portfolio's positions matching a token symbol or protocol name:
        amounts, legs, debt, rates, health and pool ranges.

        Call when the question is about a specific token, pool or protocol that the
        overview does not show in full. Pass one short word, a token symbol or a
        protocol name; it matches any word in a position that starts with it,
        whatever the case. If nothing matches, try once more with a different word
        from the question.
        """
        return find_positions(await _read(source.portfolio(portfolio, _token(ctx))), query)

    @server.tool()
    async def asset_breakdown(portfolio: PortfolioId, ctx: Context) -> str:
        """What a portfolio's money is in, counted exactly from every position's tokens:
        stablecoins against volatile assets, and each token's net amount.

        Call when the question is how much is in stablecoins or in volatile assets,
        how much of a token is held across all positions, or what share of the
        portfolio any of that is. It looks inside pools, vaults and loans and
        subtracts what is owed, which the overview cannot: it shows each position
        as one line.
        """
        read = await _read(source.portfolio(portfolio, _token(ctx)))
        return describe_exposure(exposure_of(read.positions, named_position))

    @server.tool()
    async def history_summary(portfolio: PortfolioId, period: Period, ctx: Context) -> str:
        """How a portfolio's total value moved over a period: start, last reading,
        change in USD and percent, low and high.

        Call when the question is what changed, grew or dropped, or about peaks and
        dips. Pick the smallest period that covers it ("this week" -> 7d).
        """
        history = await _read(source.history(portfolio, period, _token(ctx)))
        return summarize_history(history, period)

    @server.tool()
    def calculate(expression: str) -> str:
        """Exact arithmetic: a sum, a difference, a share, a percentage.

        Call it for every figure an answer works out rather than quotes: totals of
        several values, what is left after subtracting, what part of a whole
        something is. Pass one expression with plain numbers, + - * / and brackets,
        e.g. "(10245.13 + 32.9) / 85109.6 * 100". Quote the result it returns.
        """
        return calculated(expression)

    return server


def create_app(source: DataSource) -> Starlette:
    server = build(source)
    mcp = server.streamable_http_app(
        stateless_http=True,
        json_response=True,
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )

    @asynccontextmanager
    async def lifespan(_app: Starlette) -> AsyncIterator[None]:
        async with server.session_manager.run():
            yield

    async def health(_request: Request) -> JSONResponse:
        return JSONResponse({"ok": True})

    app = Starlette(
        routes=[Route("/health", health), *mcp.routes],
        lifespan=lifespan,
    )
    app.state.mcp = server
    return app


def _token(ctx: Context) -> str | None:
    return (ctx.headers or {}).get("authorization")


async def _read[T](reading: Awaitable[T]) -> T:
    try:
        return await reading
    except httpx.HTTPStatusError as error:
        raise ToolError(_said(error.response)) from error


def _said(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = None
    message = body.get("message") if isinstance(body, dict) else None
    return message if isinstance(message, str) else f"svinooh answered {response.status_code}."
