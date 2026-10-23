from collections.abc import AsyncIterator, Awaitable
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.exceptions import MCPServerError, ResourceError, ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp_types import ToolAnnotations
from pydantic import Field
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from svinooh_portfolio.pools import PoolCatalog
from svinooh_portfolio.portfolio import Period, Portfolio, exposure_of
from svinooh_portfolio.reading import (
    calculated,
    describe_exposure,
    describe_pools,
    find_positions,
    named_position,
    portfolio_context,
    summarize_history,
)
from svinooh_portfolio.source import DataSource, UnknownTokenError

LARGEST = 12

MAX_OPTIONS = 8

ADDRESS_AT_LEAST = 26

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)

Ticker = Annotated[str, Field(description="One token's ticker, e.g. USDC; empty for every token.")]

INSTRUCTIONS = (
    "Read-only access to crypto wallets and portfolios through svinooh.com. Pass a "
    "wallet address to read that wallet, or a portfolio's id, the part of its link "
    "after /p/, to read every wallet in it. A wallet svinooh has never read is read "
    "on first use and may show no positions for a minute. With a svinooh token in the "
    "Authorization header the caller's own portfolios can be listed and read, "
    "private ones included; without one only public portfolios can be read. "
    "Figures are in USD as of each wallet's last scan."
)

Largest = Annotated[
    int, Field(ge=1, le=100, description="How many of each wallet's largest positions to list.")
]

PositionName = Annotated[
    str, Field(description="The position's token symbol or protocol, e.g. ETH or Aave.")
]

PortfolioId = Annotated[
    str,
    Field(
        description=(
            "A wallet address on any network svinooh reads (EVM, Solana, Tron, Bitcoin), or "
            "a portfolio's id: the part of its svinooh.com link after /p/."
        )
    ),
]


def build(source: DataSource, catalog: PoolCatalog) -> MCPServer:
    """The portfolio reading tools as an MCP server, acting with the caller's own token."""
    server = MCPServer("svinooh", instructions=INSTRUCTIONS)

    @server.tool(title="My portfolios", annotations=READ_ONLY)
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

    @server.tool(title="Portfolio overview", annotations=READ_ONLY)
    async def portfolio_overview(
        portfolio: PortfolioId, ctx: Context, positions: Largest = LARGEST
    ) -> str:
        """A portfolio as a whole: its total, where the money is by network, type and
        protocol, and every wallet with its largest positions.

        Read this first; the other tools go deeper into what it summarizes.
        """
        read = await _portfolio(source, portfolio, ctx)
        return portfolio_context(read, positions)

    @server.tool(title="Position details", annotations=READ_ONLY)
    async def position_details(portfolio: PortfolioId, query: str, ctx: Context) -> str:
        """Full detail on a portfolio's positions matching a token symbol or protocol name:
        amounts, legs, debt, rates, health and pool ranges.

        Call when the question is about a specific token, pool or protocol that the
        overview does not show in full. Pass one short word, a token symbol or a
        protocol name; it matches any word in a position that starts with it,
        whatever the case. If nothing matches, try once more with a different word
        from the question.
        """
        return find_positions(await _portfolio(source, portfolio, ctx), query)

    @server.tool(title="Asset breakdown", annotations=READ_ONLY)
    async def asset_breakdown(portfolio: PortfolioId, ctx: Context) -> str:
        """What a portfolio's money is in, counted exactly from every position's tokens:
        stablecoins against volatile assets, and each token's net amount.

        Call when the question is how much is in stablecoins or in volatile assets,
        how much of a token is held across all positions, or what share of the
        portfolio any of that is. It looks inside pools, vaults and loans and
        subtracts what is owed, which the overview cannot: it shows each position
        as one line.
        """
        read = await _portfolio(source, portfolio, ctx)
        return describe_exposure(exposure_of(read.positions, named_position))

    @server.tool(title="History summary", annotations=READ_ONLY)
    async def history_summary(portfolio: PortfolioId, period: Period, ctx: Context) -> str:
        """How a portfolio's total value moved over a period: start, last reading,
        change in USD and percent, low and high.

        Call when the question is what changed, grew or dropped, or about peaks and
        dips. Pick the smallest period that covers it ("this week" -> 7d).
        """
        slug = await _slug(source, portfolio)
        history = await _read(source.history(slug, period, _token(ctx)))
        return summarize_history(history, period)

    @server.tool(title="Calculate", annotations=READ_ONLY)
    def calculate(expression: str) -> str:
        """Exact arithmetic: a sum, a difference, a share, a percentage.

        Call it for every figure an answer works out rather than quotes: totals of
        several values, what is left after subtracting, what part of a whole
        something is. Pass one expression with plain numbers, + - * / and brackets,
        e.g. "(10245.13 + 32.9) / 85109.6 * 100". Quote the result it returns.
        """
        return calculated(expression)

    @server.tool(title="Earn options", annotations=READ_ONLY)
    async def earn_options(token: Ticker = "") -> str:
        """Places that pay for a deposit of one token, best rate first.

        Call when the question is where to put money, what to earn on, which rate a
        token gets, or how to make idle funds work. Pass one ticker (USDC, SOL, PYUSD)
        to narrow it to that token; leave it empty for the best rates across every
        token. Returns each pool's rate split by where it comes from, how much is
        deposited, its minimum deposit, and a risk band with its reasons. The same
        catalog answers every call, so once per question is enough.
        """
        ticker = token.strip().upper()
        return describe_pools(await _read(catalog.best_pools(ticker or None, MAX_OPTIONS)), ticker)

    @server.resource(
        "svinooh://portfolio/{portfolio}",
        title="Portfolio",
        description="A portfolio's overview, to attach to a conversation as context.",
        mime_type="text/plain",
    )
    async def portfolio_resource(portfolio: str, ctx: Context) -> str:
        read = await _portfolio(source, portfolio, ctx, ResourceError)
        return portfolio_context(read, LARGEST)

    @server.resource(
        "svinooh://portfolio/{portfolio}/assets",
        title="Portfolio assets",
        description="What a portfolio's money is in, net of debt, to attach as context.",
        mime_type="text/plain",
    )
    async def assets_resource(portfolio: str, ctx: Context) -> str:
        read = await _portfolio(source, portfolio, ctx, ResourceError)
        return describe_exposure(exposure_of(read.positions, named_position))

    @server.prompt(title="Weekly review")
    def weekly_review(portfolio: PortfolioId) -> str:
        """How a portfolio or wallet did over the last 7 days, and why."""
        return (
            f"Review how {portfolio} did over the last 7 days; it is a svinooh portfolio or "
            "a wallet. Read its overview and its 7-day history. Say how much the total changed "
            "in USD and percent, which positions moved it most and why: price, rewards, debt or "
            "money moved in or out. Then name anything that needs attention this week, such as "
            "a loan whose health fell or a pool that left its range. Use only figures the tools "
            "return and work every sum out with the calculator."
        )

    @server.prompt(title="Risk check")
    def risk_check(portfolio: PortfolioId) -> str:
        """The risks that lose money: debt, health, concentration, pools out of range."""
        return (
            f"Check {portfolio}, a svinooh portfolio or a wallet, for the risks that lose "
            "money. Read its overview, what its money is in, and the detail of every loan and "
            "pool. Cover: each loan's health factor and how far prices can fall before "
            "liquidation; how much sits in one token, one protocol and one network; the "
            "stablecoin share; pools out of their range. Rank the risks from most to least "
            "urgent and say for each what would reduce it. Use only figures the tools return."
        )

    @server.prompt(title="Explain a position")
    def explain_position(portfolio: PortfolioId, position: PositionName) -> str:
        """One position in plain words: what it holds, what it earns, what can go wrong."""
        return (
            f"Explain the {position} position of {portfolio}, a svinooh portfolio or a "
            "wallet. Read its full detail. Say in plain words what it holds and in which "
            "amounts, what it earns and from what (rates, rewards, fees), what it owes, and "
            "what can go wrong with it. Use only figures the tools return."
        )

    @server.prompt(title="Where to earn")
    def where_to_earn(portfolio: PortfolioId) -> str:
        """Where the idle money in a portfolio or wallet could earn, safest first."""
        return (
            f"Find where the idle money in {portfolio}, a svinooh portfolio or a wallet, "
            "could earn. Read its overview to see which tokens sit idle and what already "
            "earns, then read the best rates for each idle token. Recommend two or three "
            "places, safest first, each with its net rate, where the rate comes from, its "
            "risk band and the reason for it, and what it would earn a year on the amount "
            "held. Say where moving something that already earns would gain enough to be "
            "worth it. Never promise a rate will hold: a deposit goes into a third-party "
            "protocol. Use only figures the tools return and work every sum out with the "
            "calculator."
        )

    @server.prompt(title="Compare")
    def compare(first: PortfolioId, second: PortfolioId) -> str:
        """Two portfolios or wallets side by side: size, holdings, risk, last 30 days."""
        return (
            f"Compare {first} and {second}; each is a svinooh portfolio or a wallet. Read the "
            "overview, what the money is in and the 30-day history of each. Put them side by "
            "side: total, split between stablecoins and volatile assets, largest positions, "
            "debt, and how each moved over 30 days. End with the one difference that matters "
            "most. Use only figures the tools return and work every comparison out with the "
            "calculator."
        )

    return server


def create_app(source: DataSource, catalog: PoolCatalog) -> Starlette:
    server = build(source, catalog)
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


async def _portfolio(
    source: DataSource, ref: str, ctx: Context, refused: type[MCPServerError] = ToolError
) -> Portfolio:
    return await _read(source.portfolio(await _slug(source, ref, refused), _token(ctx)), refused)


async def _slug(source: DataSource, ref: str, refused: type[MCPServerError] = ToolError) -> str:
    """A wallet address opens as the anonymous portfolio the landing search opens it as:
    found if somebody has looked before, created and first scanned if not."""
    ref = ref.strip()
    if not _looks_like_an_address(ref):
        return ref
    return await _read(source.create_anonymous_portfolio(ref), refused)


def _looks_like_an_address(ref: str) -> bool:
    return len(ref) >= ADDRESS_AT_LEAST and ref.isalnum()


def _token(ctx: Context) -> str | None:
    return (ctx.headers or {}).get("authorization")


async def _read[T](reading: Awaitable[T], refused: type[MCPServerError] = ToolError) -> T:
    try:
        return await reading
    except httpx.HTTPStatusError as error:
        raise refused(_said(error.response)) from error


def _said(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        body = None
    message = body.get("message") if isinstance(body, dict) else None
    return message if isinstance(message, str) else f"svinooh answered {response.status_code}."
