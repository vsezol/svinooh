"""Read-only drill-down tools — what the model may ask the service to fetch.

The context block (app/context.py) is the standing summary; these tools are
the magnifying glass. When a question is about a specific position or about
how things moved, the model calls a tool, the service executes it, and the
result returns to the model as a message — the agentic loop, run by
grounded_node.

Two rules hold everywhere here:

- **The model chooses arguments, never identity.** Each tool is built per
  request as a closure over the caller's slug, token and fetched data; the
  schema the model sees has only `period` or `query`. There is no argument it
  could use to point a tool at someone else's portfolio — privacy by
  construction extends to tools.
- **Code computes, the model narrates.** A history question is answered by
  Python arithmetic over the full series (up to ~1200 points); the model
  receives five computed lines, never the raw points — cheaper, and immune to
  LLM arithmetic.
"""
import logging
from datetime import datetime
from typing import Literal

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

from .context import position_line, short_address, usd

logger = logging.getLogger("svinooh-ai")

MAX_MATCHES = 30


# How wide each period actually is. The API answers a period with a series that
# reaches back SEVERAL of them, so a chart has somewhere to scroll to — which
# means the first point it returns is not the start of the period asked for.
# The product's own figure slices the window off the end of the series, and so
# does this: "over the last week" has to mean the same thing in the chat as it
# does on the page.
WINDOW_MS: dict[str, int | None] = {
    "1h": 3_600_000,
    "24h": 24 * 3_600_000,
    "7d": 7 * 86_400_000,
    "30d": 30 * 86_400_000,
    "all": None,
}


def _epoch_ms(point: dict) -> float | None:
    stamp = point.get("t")
    if isinstance(stamp, (int, float)):
        return float(stamp)
    if isinstance(stamp, str):
        try:
            # The API sends ISO-8601; a trailing Z is not something
            # fromisoformat accepts before 3.11's relaxation everywhere.
            return datetime.fromisoformat(stamp.replace("Z", "+00:00")).timestamp() * 1000
        except ValueError:
            return None
    return None


def window_of(points: list[dict], period: str) -> list[dict]:
    """The points inside the asked-for period, counted back from the last one."""
    width = WINDOW_MS.get(period)
    if width is None or not points:
        return points
    last = _epoch_ms(points[-1])
    if last is None:
        return points
    opens = last - width
    inside = [p for p in points if (_epoch_ms(p) or 0) >= opens]
    # Fewer than two readings inside the window says nothing about a change;
    # the whole series at least says something true about a longer one.
    return inside if len(inside) >= 2 else points


def summarize_history(series: dict, period: str) -> str:
    """The arithmetic half of a history answer: facts computed, not modeled."""
    usable = [p for p in (series.get("points") or []) if isinstance(p.get("usd"), (int, float))]
    points = window_of(usable, period)
    if len(points) < 2:
        return "Not enough history recorded for this period yet."
    first, last = points[0], points[-1]
    low = min(points, key=lambda p: p["usd"])
    high = max(points, key=lambda p: p["usd"])
    delta = last["usd"] - first["usd"]
    percent = (delta / first["usd"] * 100) if first["usd"] else 0.0
    return (
        f"Period {period}: {len(points)} readings.\n"
        f"Start {usd(first['usd'])} at {first.get('t')} -> last reading {usd(last['usd'])} "
        f"at {last.get('t')}.\n"
        f"Change {delta:+,.2f} USD ({percent:+.1f}%).\n"
        f"Low {usd(low['usd'])} at {low.get('t')}; high {usd(high['usd'])} at {high.get('t')}.\n"
        "The last reading is the newest recorded point, which can sit slightly "
        "behind the live total shown in the portfolio above — quote the live "
        "total when asked what the portfolio is worth now."
    )


def find_positions(data: dict, query: str) -> str:
    """Every position matching the query, uncapped by the context block's limit.

    Matches on what a person names a position by: its symbol, its full name,
    the protocol it sits in and the network it lives on. Searching the symbol
    alone was why "uniswap" found nothing in a portfolio holding three Uniswap
    pools — the protocol is in `platform`, and nobody asks about a pool by its
    LP token symbol.
    """
    needle = query.strip().lower()
    if not needle:
        return "Empty query."
    matches = []
    for wallet in data.get("wallets") or []:
        address = short_address(wallet.get("address") or "?")
        for position in wallet.get("positions") or []:
            haystack = " ".join(
                str(position.get(field) or "")
                for field in ("symbol", "name", "platform", "network", "category")
            ).lower()
            if needle in haystack:
                matches.append((position.get("valueUsd") or 0, address, position))
    if not matches:
        return (
            f'No position matches "{query}". The portfolio holds: '
            + ", ".join(sorted({
                str(p.get("platform"))
                for w in (data.get("wallets") or [])
                for p in (w.get("positions") or [])
                if p.get("platform") and p.get("platform") != "wallet"
            }) or ["no protocol positions"])
            + " — and plain token holdings."
        )
    matches.sort(key=lambda row: -row[0])
    total = sum(value for value, _, _ in matches)
    head = (
        f'{len(matches)} position(s) match "{query}", {usd(total)} in total'
        + (f" (showing the largest {MAX_MATCHES})" if len(matches) > MAX_MATCHES else "")
        + ":"
    )
    lines = [
        f"{address}: {position_line(position, detail=True)}"
        for _, address, position in matches[:MAX_MATCHES]
    ]
    return "\n".join([head, *lines])


def portfolio_tools(source, slug: str, token: str, data: dict) -> list:
    """Build this request's tools around this caller's portfolio.

    The docstrings below are not documentation — they are the instructions the
    model reads when deciding whether and how to call.
    """

    @tool
    async def history_summary(period: Literal["1h", "24h", "7d", "30d", "all"]) -> str:
        """How the portfolio's total value moved over a period.

        Call when the user asks what changed, grew or dropped, or about peaks
        and dips. Returns computed facts: start, end, change in USD and
        percent, low and high. Pick the smallest period that covers the
        question ("this week" -> 7d).
        """
        return summarize_history(await source.history(slug, period, token), period)

    @tool
    def position_details(query: str) -> str:
        """Full detail on positions matching a token symbol or protocol name.

        Call when the user asks about a specific token, pool or protocol that
        the portfolio overview above does not show. The match is a
        case-insensitive substring, so pass one short word — a token symbol or
        a protocol name: "aave", "usdc", "uniswap". If nothing matches, try
        once more with a different word from the user's question.
        """
        return find_positions(data, query)

    return [history_summary, position_details]


async def run_tools(calls: list[dict], tools: list) -> list[ToolMessage]:
    """Execute the model's tool calls; every outcome returns as a message.

    A failing tool does not fail the turn: the error text goes back to the
    model as the tool's result, and the model decides what to tell the user —
    the same honesty rule the context fetch follows, one level deeper.
    """
    by_name = {t.name: t for t in tools}
    results = []
    for call in calls:
        name, args = call.get("name", ""), call.get("args", {})
        try:
            handler = by_name.get(name)
            if handler is None:
                raise KeyError(f"unknown tool: {name}")
            result = await handler.ainvoke(args)
            logger.info("tool %s(%s) -> %d chars", name, args, len(str(result)))
        except Exception as error:  # noqa: BLE001 — the model handles tool failures
            logger.warning("tool %s failed: %r", name, error)
            result = f"Tool call failed: {error}"
        results.append(ToolMessage(content=str(result), tool_call_id=call.get("id", "")))
    return results
