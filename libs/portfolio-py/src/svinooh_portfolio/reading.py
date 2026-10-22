from decimal import Decimal

from .arithmetic import evaluate
from .portfolio import Exposure, History, Portfolio, Position, Side, Total, Wallet, total_of

MAX_CHARS = 6000

ROOM_FOR_THE_CUT = 80

UNNAMED_POSITION = "unnamed position"

UNNAMED_TOKEN = "unnamed token"

NO_NAME = ("", "?")


def named(symbol: str | None, unnamed: str) -> str:
    clean = (symbol or "").strip()
    return unnamed if clean in NO_NAME else clean


def usd(value: float | None) -> str:
    return f"${value:,.2f}" if value is not None else "n/a"


def short_address(address: str) -> str:
    return address if len(address) <= 14 else f"{address[:8]}…{address[-4:]}"


def amount_at(amount: float | None, price: float | None) -> str | None:
    if amount is None or amount <= 0:
        return None
    figure = f"{amount:,.4f}".rstrip("0").rstrip(".") if amount < 1000 else f"{amount:,.0f}"
    if price is None or price <= 0:
        return figure
    if price >= 0.01:
        shown = f"{price:,.2f}"
    elif price >= 1e-6:
        shown = f"{price:.8f}".rstrip("0").rstrip(".")
    else:
        shown = f"{price:.2e}"
    return f"{figure} @ ${shown}"


def rate(fraction: float) -> str:
    percent = fraction * 100
    if 0 < percent < 0.01:
        return "<0.01%"
    return f"{percent:.2f}%"


def _rates(position: Position) -> list[str]:
    facts = []
    if position.apy is not None:
        facts.append(f"APY {position.apy * 100:.1f}%")
    if position.fees_earned_usd is not None:
        facts.append(f"fees earned in GMX {usd(position.fees_earned_usd)} all time")
    if position.health_rate is not None:
        facts.append(f"health {position.health_rate:.2f}")
    if position.borrow_apy is not None:
        facts.append(f"borrow {position.borrow_apy * 100:.1f}%")
    if position.range:
        facts.append(f"range {position.range}")
    return facts


def _where(position: Position) -> list[str]:
    return [fact for fact in (position.network, position.protocol) if fact]


def _pair(position: Position) -> str | None:
    band = position.band
    if band is None:
        return None
    return band.pair + (f" {band.fee_pct}% fee" if band.fee_pct is not None else "")


def _composition(position: Position) -> str | None:
    parts = []
    for leg in position.legs[:6]:
        piece = f"{named(leg.symbol, UNNAMED_TOKEN)} {usd(abs(leg.value_usd))}"
        amount = amount_at(leg.amount, leg.price_usd)
        if amount:
            piece += f" ({amount})"
        if leg.apy is not None:
            piece += f" at {rate(leg.apy)}"
        if leg.role and leg.role != "supply":
            piece = f"{leg.role} {piece}"
        parts.append(piece)
    return " + ".join(parts) if parts else None


def named_position(position: Position) -> str:
    head = _head(position)
    return f"{head} on {position.network}" if position.network else head


def position_line(position: Position, detail: bool = False) -> str:
    head = _head(position)
    pair = _pair(position)
    if pair:
        head = f"{head} [{pair}]"
    facts = [usd(position.value_usd)]
    amount = amount_at(position.amount, position.price_usd)
    if amount:
        facts.append(amount)
    facts.extend(_where(position))
    facts.extend(_rates(position))
    line = f"{head}: {', '.join(facts)}"
    composition = _composition(position) if detail else None
    return f"{line} — {composition}" if composition else line


def _head(position: Position) -> str:
    head = named(position.symbol, UNNAMED_POSITION)
    return f"{head} ({position.name})" if position.name and position.name != head else head


def _breakdown(label: str, totals: tuple[Total, ...], whole: float, limit: int = 8) -> str | None:
    if not totals:
        return None
    parts = []
    for total in totals[:limit]:
        share = f" ({total.usd / whole * 100:.0f}%)" if whole else ""
        parts.append(f"{total.label} {usd(total.usd)}{share}")
    if len(totals) > limit:
        rest = sum(total.usd for total in totals[limit:])
        parts.append(f"+{len(totals) - limit} more {usd(rest)}")
    return f"{label}: {', '.join(parts)}"


def _wallet_lines(wallet: Wallet, cap: int) -> list[str]:
    stale = ", stale data" if wallet.stale else ""
    positions = wallet.largest_first
    header = (
        f"Wallet {short_address(wallet.address)} "
        f"[{wallet.chain}] — {usd(wallet.total_usd)}, "
        f"{len(positions)} position(s), status {wallet.status}{stale}:"
    )
    lines = [header] + [f"  - {position_line(p)}" for p in positions[:cap]]
    rest = positions[cap:]
    if rest:
        lines.append(
            f"  - …and {len(rest)} smaller positions worth {usd(total_of(rest))} in total "
            "(ask for details on any of them with the position search tool)"
        )
    return lines


def portfolio_context(portfolio: Portfolio, max_positions: int) -> str:
    whole = portfolio.total_usd
    lines = [
        f'Portfolio "{portfolio.title}" — '
        f"total {usd(whole)}, {len(portfolio.wallets)} wallet(s), "
        f"{len(portfolio.positions)} position(s)."
    ]
    for line in (
        _breakdown("By network", portfolio.totals_by(lambda p: p.network), whole),
        _breakdown("By type", portfolio.totals_by(lambda p: p.category), whole),
        _breakdown("In protocols", portfolio.totals_by(lambda p: p.protocol), whole),
    ):
        if line:
            lines.append(line)
    for wallet in portfolio.wallets:
        lines.extend(_wallet_lines(wallet, max_positions))
    return _capped(lines)


def _capped(lines: list[str]) -> str:
    whole = "\n".join(lines)
    if len(whole) <= MAX_CHARS:
        return whole
    kept: list[str] = []
    used = 0
    for line in lines:
        if used + len(line) + 1 > MAX_CHARS - ROOM_FOR_THE_CUT:
            break
        kept.append(line)
        used += len(line) + 1
    kept.append(f"…and {len(lines) - len(kept)} more lines, left out for length")
    return "\n".join(kept)


MAX_MATCHES = 30

MAX_TOKENS_LISTED = 25


def summarize_history(history: History, period: str) -> str:
    change = history.change(period)
    if change is None:
        return "Not enough history recorded for this period yet."
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


def describe_exposure(exposure: Exposure) -> str:
    total = exposure.total
    lines = [
        "Counted from every position's underlying tokens; what is owed is subtracted. "
        f"Counted total {money(total)}.",
        f"Stablecoins: {_side(exposure.stable, total)}.",
        f"Volatile assets: {_side(exposure.volatile, total)}.",
    ]
    if exposure.unsplit:
        listed = ", ".join(f"{where} {money(usd)}" for where, usd in exposure.unsplit)
        lines.append(
            f"Contents not reported by the source, so in neither figure above: "
            f"{money(exposure.unsplit_usd)} ({share(exposure.unsplit_usd, total)}) — {listed}."
        )
    if exposure.stable_in:
        lines.append(
            "Stablecoins by position: "
            + "; ".join(f"{where} {_held_and_owed(side)}" for where, side in exposure.stable_in)
            + "."
        )
    shown = exposure.by_token[:MAX_TOKENS_LISTED]
    tokens = ", ".join(
        f"{symbol} {money(side.net)} ({share(side.net, total)})" for symbol, side in shown
    )
    left = exposure.by_token[MAX_TOKENS_LISTED:]
    if left:
        tokens += f", +{len(left)} more {money(sum((side.net for _, side in left), Decimal(0)))}"
    lines.append(f"By token, net: {tokens}.")
    return "\n".join(lines)


def calculated(expression: str) -> str:
    try:
        result = evaluate(expression)
    except (ArithmeticError, SyntaxError, ValueError) as error:
        return f"Could not calculate {expression!r}: {error}"
    exact = format(result.quantize(Decimal("1e-10")).normalize(), "f")
    return f"{expression} = {exact} (rounded to cents: {result:,.2f})"


def money(value: Decimal) -> str:
    return f"-${abs(value):,.2f}" if value < 0 else f"${value:,.2f}"


def share(part: Decimal, whole: Decimal) -> str:
    return f"{part / whole * 100:.2f}%" if whole else "n/a"


def _side(side: Side, total: Decimal) -> str:
    net = f"{money(side.net)} net — {share(side.net, total)} of the counted total"
    return f"{_held_and_owed(side)}, {net}"


def _held_and_owed(side: Side) -> str:
    return f"{money(side.held)} held, {money(side.owed)} owed"
