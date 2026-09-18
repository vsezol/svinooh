"""Read-only drill-down tools — what the model may ask the service to fetch.

The context block (app/agent/context.py) is the standing summary; these tools
are the magnifying glass. When a question is about a specific position or
about how things moved, the model calls a tool, the service executes it, and
the result returns to the model as a message — the agentic loop, run by the
grounded node.

Two rules hold everywhere here:

- **The model chooses arguments, never identity.** Each tool is built per
  request as a closure over the caller's slug, token and fetched portfolio;
  the schema the model sees has only `period` or `query`. There is no argument
  it could use to point a tool at someone else's portfolio — privacy by
  construction extends to tools.
- **Code computes, the model narrates.** The arithmetic is the domain's
  (app/domain/portfolio.py), over the full series; the model receives a few
  computed lines, never the raw points — cheaper, and immune to LLM
  arithmetic. What is left in this module is the wording.
"""

import logging
from decimal import Decimal

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

from ..adapters.earn import YieldCatalog
from ..adapters.portfolio import DataSource
from ..domain.earn import CatalogSnapshot, YieldPool
from ..domain.portfolio import History, Period, Portfolio, total_of
from ..observability import metrics
from .context import position_line, short_address, usd
from .steps import said, step, tool_label

logger = logging.getLogger("svinooh-ai")

MAX_MATCHES = 30

#: Handed to the model in place of a result when a call fails. A failure it is
#: only told about is a gap it fills: the answer that started this said the
#: tool was unavailable and then quoted a rate anyway.
NOTHING_CAME_BACK = (
    "This call failed, so you have nothing from it. Say plainly that you could "
    "not read this right now, name no figure that would have come from it, and "
    "do not answer it from memory."
)

#: A chat answer is read, not scrolled — past a handful it is a spreadsheet.
MAX_OPTIONS = 8


def summarize_history(history: History, period: str) -> str:
    """A period's change, said in the words the model will quote."""
    change = history.change(period)
    if change is None:
        said("not enough history")
        return "Not enough history recorded for this period yet."
    said(f"{len(change.readings)} readings · {change.percent:+.1f}%")
    return (
        f"Period {period}: {len(change.readings)} readings.\n"
        f"Start {usd(change.first.usd)} at {change.first.at} -> "
        f"last reading {usd(change.last.usd)} at {change.last.at}.\n"
        f"Change {change.delta:+,.2f} USD ({change.percent:+.1f}%).\n"
        f"Low {usd(change.low.usd)} at {change.low.at}; "
        f"high {usd(change.high.usd)} at {change.high.at}.\n"
        "The last reading is the newest recorded point, which can sit slightly "
        "behind the live total shown in the portfolio above — quote the live "
        "total when asked what the portfolio is worth now."
    )


def find_positions(portfolio: Portfolio, query: str) -> str:
    """Every position matching the query, uncapped by the context block's limit."""
    if not query.strip():
        return "Empty query."
    matches = portfolio.matching(query)
    said(f"{len(matches)} matched" if matches else "nothing matched")
    if not matches:
        # A miss names what IS there, so the model's next guess is informed
        # rather than another word from the same question.
        held = ", ".join(portfolio.protocols) or "no protocol positions"
        return (
            f'No position matches "{query}". '
            f"The portfolio holds: {held} — and plain token holdings."
        )
    total = total_of(match.position for match in matches)
    head = (
        f'{len(matches)} position(s) match "{query}", {usd(total)} in total'
        + (f" (showing the largest {MAX_MATCHES})" if len(matches) > MAX_MATCHES else "")
        + ":"
    )
    lines = [
        f"{short_address(match.address)}: {position_line(match.position, detail=True)}"
        for match in matches[:MAX_MATCHES]
    ]
    return "\n".join([head, *lines])


def earn_tools(catalog: YieldCatalog) -> list:
    """The catalog, as the one tool the earn branch reasons with."""

    @tool
    async def earn_options(token: str = "") -> str:
        """Places that pay for a deposit of one token, best rate first.

        Call whenever the user asks where to put money, what to earn on, which
        rate a token gets, or how to make idle funds work. Pass one ticker —
        USDC, SOL, PYUSD — to narrow it to that token; leave it empty for the
        best rates across every token. Returns each pool's rate split by where
        it comes from, how much is deposited, and a risk band with its reasons.
        """
        ticker = token.strip().upper()
        return describe_pools(await catalog.best_pools(ticker or None, MAX_OPTIONS), ticker)

    return [earn_options]


def describe_pools(snapshot: CatalogSnapshot, asked_for: str) -> str:
    """The catalog as the lines the model quotes: same four facts per pool."""
    said(pools_found(snapshot))
    if not snapshot.pools:
        asked = f" for {asked_for}" if asked_for else ""
        return (
            f"The catalog has nothing{asked} right now. Say so plainly; do not "
            "substitute a token that was not asked about."
        )
    read_at = snapshot.as_of.isoformat(timespec="minutes") if snapshot.as_of else "an unknown time"
    stale = " The catalog could not be refreshed, so these rates are older than usual."
    lines = [f"Read at {read_at}.{stale if snapshot.stale else ''}"]
    for pool in snapshot.pools:
        reasons = "; ".join(pool.risk_reasons)
        lines.append(
            f"- {pool.name} ({pool.protocol} {pool.kind}) pays "
            f"{as_percent(pool.apy_net)} net on {pool.token} = {rate_breakdown(pool)}. "
            f"{as_money(pool.tvl_usd)} deposited. Risk {pool.risk}"
            f"{f': {reasons}' if reasons else ''}. id {pool.id}"
        )
    lines.append(
        "Quote the net rate, name the risk in words with its reason, and never "
        "promise a rate will hold — base is what borrowers pay, the rest ends."
    )
    return "\n".join(lines)


def pools_found(snapshot: CatalogSnapshot) -> str:
    """What the catalog answered with, for the line the reader is watching."""
    if not snapshot.pools:
        return "nothing listed"
    pools = f"{len(snapshot.pools)} pools" if len(snapshot.pools) > 1 else "1 pool"
    return f"{pools} · best {as_percent(max(pool.apy_net for pool in snapshot.pools))}"


def rate_breakdown(pool: YieldPool) -> str:
    """Where the rate comes from, naming only the parts that pay anything."""
    parts = [f"{as_percent(pool.apy_base)} base"]
    if pool.apy_rewards > 0:
        parts.append(f"{as_percent(pool.apy_rewards)} rewards")
    if pool.apy_incentives > 0:
        parts.append(f"{as_percent(pool.apy_incentives)} incentives")
    return " + ".join(parts)


def as_percent(value: Decimal) -> str:
    """A fraction as the percentage a person reads: 0.0508 is 5.08%."""
    return f"{value * 100:.2f}%"


def as_money(value: Decimal) -> str:
    """A size at the magnitude that carries the meaning: $4.9M, $850k."""
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.0f}k"
    return f"${value:,.0f}"


def portfolio_tools(source: DataSource, slug: str, token: str | None, portfolio: Portfolio) -> list:
    """Build this request's tools around this caller's portfolio.

    The docstrings below are not documentation — they are the instructions the
    model reads when deciding whether and how to call.
    """

    @tool
    async def history_summary(period: Period) -> str:
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

        Call when the user asks about a specific token, pool or protocol
        that the portfolio overview above does not show. Pass one short word
        — a token symbol or a protocol name — and it matches any word in a
        position that starts with it, whatever the case. If nothing matches,
        try once more with a different word from the user's question.
        """
        return find_positions(portfolio, query)

    return [history_summary, position_details]


# How long a period sounds when somebody says it out loud.
_PERIODS = {
    "1h": "the last hour",
    "24h": "the last 24 hours",
    "7d": "the last 7 days",
    "30d": "the last 30 days",
    "all": "the whole history",
}


def tool_phrase(name: str, args: dict) -> str | None:
    """What a call is doing, in the words a reader would use for it.

    The trace is meant to be read by whoever asked the question, and
    "history_summary · 7d" is the name of a function, not an account of
    anything. What it must not become is prose that has drifted from the call:
    every phrase here names the same argument the call was made with, so the
    line is still checkable against what ran.

    One phrase per tool, and lives beside the tools so adding one is a line
    away from adding the other. A tool with no phrase returns None and is
    reported by its own name -- honest rather than tidy.
    """
    if name == "history_summary":
        period = str(args.get("period", ""))
        return f"Reading the total over {_PERIODS[period]}" if period in _PERIODS else None
    if name == "position_details":
        query = str(args.get("query", "")).strip()
        return f"Reading positions · {query}" if query else None
    if name == "earn_options":
        token = str(args.get("token", "")).strip().upper()
        return f"Reading lending rates · {token}" if token else "Reading lending rates"
    return None


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
        # The label is the tool's own name only when we have one by that name:
        # the model picks this string, and an invented one must not become a
        # series of its own.
        counted_as = name if name in by_name else "unknown"
        try:
            handler = by_name.get(name)
            if handler is None:
                raise KeyError(f"unknown tool: {name}")
            # Said in the words a reader would use, and falling back to the
            # tool's own name and argument, so the line on screen cannot
            # describe something other than the call that ran.
            async with step(
                call.get("id") or name, tool_phrase(name, args) or tool_label(name, args)
            ):
                result = await handler.ainvoke(args)
            logger.info("tool %s(%s) -> %d chars", name, args, len(str(result)))
            metrics.counted(metrics.tool_calls, tool=counted_as, outcome="ok")
        except Exception as error:  # noqa: BLE001 — the model handles tool failures
            logger.warning("tool %s failed: %r", name, error)
            metrics.counted(metrics.tool_calls, tool=counted_as, outcome="failed")
            result = f"{error}\n{NOTHING_CAME_BACK}"
        results.append(ToolMessage(content=str(result), tool_call_id=call.get("id", "")))
    return results
