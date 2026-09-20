import logging
from decimal import Decimal, InvalidOperation

from langchain_core.messages import ToolMessage
from langchain_core.tools import tool

from ..adapters.earn import YieldCatalog
from ..adapters.portfolio import DataSource
from ..domain.asking import MAX_ANSWERS, MIN_ANSWERS, Choice
from ..domain.earn import CatalogSnapshot, Deposit, YieldPool
from ..domain.portfolio import History, Period, Portfolio, total_of
from ..observability import metrics
from .context import position_line, short_address, usd
from .steps import said, step, tool_label

logger = logging.getLogger("svinooh-ai")

MAX_MATCHES = 30

NOTHING_CAME_BACK = (
    "This call failed, so you have nothing from it. Say plainly that you could "
    "not read this right now, name no figure that would have come from it, and "
    "do not answer it from memory."
)

MAX_OPTIONS = 8


def summarize_history(history: History, period: str) -> str:
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
    if not query.strip():
        return "Empty query."
    matches = portfolio.matching(query)
    said(f"{len(matches)} matched" if matches else "nothing matched")
    if not matches:
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

    @tool
    async def earn_options(token: str = "") -> str:
        """Places that pay for a deposit of one token, best rate first.

        Call whenever the user asks where to put money, what to earn on, which
        rate a token gets, or how to make idle funds work. Pass one ticker —
        USDC, SOL, PYUSD — to narrow it to that token; leave it empty for the
        best rates across every token. Returns each pool's rate split by where
        it comes from, how much is deposited, its minimum deposit, and a risk
        band with its reasons.

        Once per turn is enough: the same catalog answers every call, so a
        second one spends a step you may need to prepare the deposit with.
        """
        ticker = token.strip().upper()
        return describe_pools(await catalog.best_pools(ticker or None, MAX_OPTIONS), ticker)

    return [earn_options]


def asking_tools(asked: list[Choice]) -> list:
    @tool
    def ask_the_user(header: str, question: str, options: list[str]) -> str:
        """Put one question in front of the user as buttons they tap.

        Call it instead of guessing anything you need and do not have: which
        token of theirs to place, how much risk they want, which pool of two
        you cannot choose between. `header` is one or two words naming what is
        being chosen ("Token", "Risk"). `question` is the question itself, one
        sentence, in their language. `options` are two to four answers, each a
        short phrase they can tap — name the real thing, with the figure where
        there is one: "USDC 12.00", not "the stablecoin".

        Ask only for what you cannot read: the amounts are in front of you, and
        a token they already named is not a question. Call it twice in a turn
        for two things, and never for more. Then stop and wait: prepare
        nothing, propose nothing, and say at most one line above the buttons.
        """
        chosen = Choice(
            header=header.strip(),
            question=question.strip(),
            options=tuple(option.strip() for option in options if option.strip()),
        )
        if not chosen.question:
            return "A question with no words is not a question. Call again with one."
        if not chosen.is_answerable:
            return (
                f"Give between {MIN_ANSWERS} and {MAX_ANSWERS} answers to tap, each a short "
                "phrase. Call again with those."
            )
        asked.append(chosen)
        return (
            f"{chosen.header or 'The question'} is on their screen with those buttons. Stop "
            "here: write at most one short line above it, prepare nothing, propose nothing, "
            "and wait for the answer."
        )

    return [ask_the_user]


def deposit_tools(catalog: YieldCatalog, prepared: list[Deposit]) -> list:
    @tool
    async def propose_deposit(pool_id: str, amount: str) -> str:
        """Put a deposit in front of the user to sign, once you know both facts.

        Call it only when the user has asked you to place money AND you know
        which pool and how much. `pool_id` is the id printed beside the pool in
        the rates you were given. `amount` is a plain number of tokens — no
        symbol, no currency. It moves nothing: the user signs it in their own
        wallet, and until they do, nothing has happened. Say what it is and
        leave it with them.
        """
        size = _amount(amount)
        if size is None:
            return "That amount is not a number of tokens. Ask the user how much, and call again."
        pool = await catalog.pool(pool_id.strip())
        if pool is None:
            return (
                f"No pool has the id {pool_id}. Use an id exactly as it was printed beside a "
                "pool in the rates, or read the rates again."
            )
        if pool.terms is None:
            return (
                f"{pool.name} cannot be deposited into from here — the catalog has no accounts "
                "for it. Say so and offer one of the others."
            )
        deposit = Deposit(pool=pool, amount=size, terms=pool.terms)
        if deposit.below_minimum:
            return (
                f"{pool.name} takes at least {pool.terms.min_amount} {pool.token}. "
                "Tell the user the minimum and ask whether to go ahead with it."
            )
        prepared.append(deposit)
        return (
            f"Ready for the user to sign: {size} {pool.token} into {pool.name} "
            f"({pool.protocol} {pool.kind}) at {as_percent(pool.apy_net)}. They see it as a card "
            "with a button. Tell them what it is in one or two sentences, that the money leaves "
            "their own wallet straight into the protocol, and that nothing happens until they "
            "sign. Do not say it is done."
        )

    return [propose_deposit]


def _amount(raw: str) -> Decimal | None:
    try:
        size = Decimal(str(raw).strip().replace(",", "").replace("_", ""))
    except InvalidOperation:
        return None
    return size if size > 0 else None


def describe_pools(snapshot: CatalogSnapshot, asked_for: str) -> str:
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
        least = pool.terms.min_amount if pool.terms else None
        lines.append(
            f"- {pool.name} ({pool.protocol} {pool.kind}) pays "
            f"{as_percent(pool.apy_net)} net on {pool.token} = {rate_breakdown(pool)}. "
            f"{as_money(pool.tvl_usd)} deposited. Risk {pool.risk}"
            f"{f': {reasons}' if reasons else ''}."
            f"{f' Takes {least:f} {pool.token} at least.' if least else ''}"
            f" id {pool.id}"
        )
    lines.append(
        "Quote the net rate, name the risk in words with its reason, and never "
        "promise a rate will hold — base is what borrowers pay, the rest ends. "
        "Where a pool states a minimum, check it against what the user has "
        "before you name that pool: proposing one they cannot reach spends "
        "their turn on a refusal you could have read here."
    )
    return "\n".join(lines)


def pools_found(snapshot: CatalogSnapshot) -> str:
    if not snapshot.pools:
        return "nothing listed"
    pools = f"{len(snapshot.pools)} pools" if len(snapshot.pools) > 1 else "1 pool"
    return f"{pools} · best {as_percent(max(pool.apy_net for pool in snapshot.pools))}"


def rate_breakdown(pool: YieldPool) -> str:
    parts = [f"{as_percent(pool.apy_base)} base"]
    if pool.apy_rewards > 0:
        parts.append(f"{as_percent(pool.apy_rewards)} rewards")
    if pool.apy_incentives > 0:
        parts.append(f"{as_percent(pool.apy_incentives)} incentives")
    return " + ".join(parts)


def as_percent(value: Decimal) -> str:
    return f"{value * 100:.2f}%"


def as_money(value: Decimal) -> str:
    if value >= 1_000_000:
        return f"${value / 1_000_000:,.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:,.0f}k"
    return f"${value:,.0f}"


def portfolio_tools(source: DataSource, slug: str, token: str | None, portfolio: Portfolio) -> list:

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


_PERIODS = {
    "1h": "the last hour",
    "24h": "the last 24 hours",
    "7d": "the last 7 days",
    "30d": "the last 30 days",
    "all": "the whole history",
}


def tool_phrase(name: str, args: dict) -> str | None:
    if name == "history_summary":
        period = str(args.get("period", ""))
        return f"Reading the total over {_PERIODS[period]}" if period in _PERIODS else None
    if name == "position_details":
        query = str(args.get("query", "")).strip()
        return f"Reading positions · {query}" if query else None
    if name == "earn_options":
        token = str(args.get("token", "")).strip().upper()
        return f"Reading lending rates · {token}" if token else "Reading lending rates"
    if name == "propose_deposit":
        pool = str(args.get("pool_id", "")).strip()
        return f"Preparing a deposit · {pool}" if pool else "Preparing a deposit"
    return None


async def run_tools(calls: list[dict], tools: list) -> list[ToolMessage]:
    by_name = {t.name: t for t in tools}
    results = []
    for call in calls:
        name, args = call.get("name", ""), call.get("args", {})
        counted_as = name if name in by_name else "unknown"
        try:
            handler = by_name.get(name)
            if handler is None:
                raise KeyError(f"unknown tool: {name}")
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
