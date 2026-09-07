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
from typing import Literal

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

from .context import position_line, short_address, usd

logger = logging.getLogger("svinooh-ai")

MAX_MATCHES = 30


def summarize_history(series: dict) -> str:
    """The arithmetic half of a history answer: facts computed, not modeled."""
    points = [p for p in (series.get("points") or []) if isinstance(p.get("usd"), (int, float))]
    if len(points) < 2:
        return "Not enough history recorded for this period yet."
    first, last = points[0], points[-1]
    low = min(points, key=lambda p: p["usd"])
    high = max(points, key=lambda p: p["usd"])
    delta = last["usd"] - first["usd"]
    percent = (delta / first["usd"] * 100) if first["usd"] else 0.0
    return (
        f"Period {series.get('range')}: {len(points)} readings.\n"
        f"Start {usd(first['usd'])} at {first.get('t')} -> now {usd(last['usd'])} at {last.get('t')}.\n"
        f"Change {delta:+,.2f} USD ({percent:+.1f}%).\n"
        f"Low {usd(low['usd'])} at {low.get('t')}; high {usd(high['usd'])} at {high.get('t')}."
    )


def find_positions(data: dict, query: str) -> str:
    """Every position matching the query, uncapped by the context block's limit."""
    needle = query.strip().lower()
    if not needle:
        return "Empty query."
    lines = []
    for wallet in data.get("wallets") or []:
        for position in wallet.get("positions") or []:
            haystack = f"{position.get('symbol') or ''} {position.get('name') or ''}".lower()
            if needle in haystack:
                lines.append(
                    f"{short_address(wallet.get('address') or '?')}: {position_line(position)}"
                )
    if not lines:
        return f'No position matches "{query}" in this portfolio.'
    return "\n".join(lines[:MAX_MATCHES])


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
        return summarize_history(await source.history(slug, period, token))

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
