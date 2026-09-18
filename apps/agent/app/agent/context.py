"""What the model is told about the portfolio on screen.

Rebuilt from the public API on every turn and injected into the system prompt
rather than stored in the session: balances move between turns, and a
remembered number is a wrong number. Kept compact and capped — the model needs
the shape of the portfolio (totals, the positions that matter, the risk
figures), not every dust position; every character here is billed on every
turn of the conversation.

It renders, and computes nothing: the totals and the groupings are the
portfolio's own (app/domain/portfolio.py). What is said AROUND this block —
the instructions, the branch variants — is app/agent/prompts.py.
"""

from ..domain.portfolio import Portfolio, Position, Total, Wallet, total_of

MAX_CHARS = 6000


def usd(value: float | None) -> str:
    return f"${value:,.2f}" if value is not None else "n/a"


def short_address(address: str) -> str:
    return address if len(address) <= 14 else f"{address[:8]}…{address[-4:]}"


def _amount(amount: float | None, price: float | None) -> str | None:
    """How much of it there is — the answer to "how much ETH do I have"."""
    if amount is None or amount <= 0:
        return None
    figure = f"{amount:,.4f}".rstrip("0").rstrip(".") if amount < 1000 else f"{amount:,.0f}"
    if price is None or price <= 0:
        return figure
    # Sub-cent prices are the rule in this asset class, not the exception, and
    # a token priced at 6e-08 must not print as "$0" — a zero price next to a
    # five-figure value is a contradiction the model is left to resolve alone.
    if price >= 0.01:
        shown = f"{price:,.2f}"
    elif price >= 1e-6:
        shown = f"{price:.8f}".rstrip("0").rstrip(".")
    else:
        shown = f"{price:.2e}"
    return f"{figure} @ ${shown}"


def _rates(position: Position) -> list[str]:
    """The figures a position carries when its kind has them.

    The two rates arrive as fractions (0.42 is 42%); range is a plain word.
    """
    facts = []
    if position.apy is not None:
        facts.append(f"APY {position.apy * 100:.1f}%")
    if position.health_rate is not None:
        facts.append(f"health {position.health_rate:.2f}")
    if position.borrow_apy is not None:
        facts.append(f"borrow {position.borrow_apy * 100:.1f}%")
    if position.range:
        facts.append(f"range {position.range}")
    return facts


def _where(position: Position) -> list[str]:
    """Which network, and which protocol if it is not simply held in the wallet.

    Both were missing from this block until a portfolio with a thousand
    positions made their absence obvious: without them, a question about Base
    or about Uniswap pools has nothing in the context to answer it, and an
    answer with nothing behind it is the kind that gets invented.
    """
    return [fact for fact in (position.network, position.protocol) if fact]


def _pair(position: Position) -> str | None:
    """The pool a liquidity position is in, and what trading there costs.

    Dropped on the floor until a chat answered "what about my Uniswap pools"
    with "the pairs are not in the data" — while the pairs were in the data.
    """
    band = position.band
    if band is None:
        return None
    return band.pair + (f" {band.fee_pct}% fee" if band.fee_pct is not None else "")


def _composition(position: Position) -> str | None:
    """What a position is actually made of — supplied and borrowed legs."""
    parts = []
    for leg in position.legs[:6]:
        piece = f"{leg.symbol} {usd(leg.value_usd)}"
        amount = _amount(leg.amount, leg.price_usd)
        if amount:
            piece += f" ({amount})"
        if leg.role and leg.role != "supply":
            piece = f"{leg.role} {piece}"
        parts.append(piece)
    return " + ".join(parts) if parts else None


def positions_read(portfolio: Portfolio, name_at_most: int = 3) -> str:
    """What a portfolio read came back with, for the line reporting it.

    The networks by name rather than counted: "3 networks" is a number, and
    what the reader is checking is whether the thing they asked about was
    looked at.
    """
    if not portfolio.positions:
        return "nothing held"
    held = f"{len(portfolio.positions)} positions"
    networks = sorted({p.network for p in portfolio.positions if p.network})
    if not networks:
        return held
    named = ", ".join(networks[:name_at_most])
    left = len(networks) - name_at_most
    return f"{held} · {named}{f' +{left}' if left > 0 else ''}"


def earning_lines(portfolio: Portfolio, limit: int = 10) -> str:
    """The positions already paying a rate, biggest first. Empty when none are."""
    earning = sorted(
        (p for p in portfolio.positions if p.apy and p.apy > 0),
        key=lambda p: p.value_usd,
        reverse=True,
    )
    return "\n".join(
        f"- {p.symbol}{f' ({p.name})' if p.name else ''} on {p.protocol or 'wallet'}: "
        f"{usd(p.value_usd)} at {p.apy * 100:.2f}%"
        for p in earning[:limit]
        if p.apy
    )


def position_line(position: Position, detail: bool = False) -> str:
    head = position.symbol or "?"
    if position.name and position.name != head:
        head = f"{head} ({position.name})"
    pair = _pair(position)
    if pair:
        head = f"{head} [{pair}]"
    facts = [usd(position.value_usd)]
    amount = _amount(position.amount, position.price_usd)
    if amount:
        facts.append(amount)
    facts.extend(_where(position))
    facts.extend(_rates(position))
    line = f"{head}: {', '.join(facts)}"
    # Composition is long enough to crowd the standing block, so it belongs to
    # the drill-down that asked for detail.
    composition = _composition(position) if detail else None
    return f"{line} — {composition}" if composition else line


def _breakdown(label: str, totals: tuple[Total, ...], whole: float, limit: int = 8) -> str | None:
    """One line of "where the money is", with shares that add up."""
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
        # The tail's value, not just its count: a model told only that 1004
        # positions exist will either ignore them or guess at them, and both
        # come out as a wrong total.
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
    # The shape of the money, computed over EVERY position rather than the few
    # the cap prints. These three lines are what make "where is my money by
    # chain" answerable without guessing, however long the tail is.
    for line in (
        _breakdown("By network", portfolio.totals_by(lambda p: p.network), whole),
        _breakdown("By type", portfolio.totals_by(lambda p: p.category), whole),
        _breakdown("In protocols", portfolio.totals_by(lambda p: p.protocol), whole),
    ):
        if line:
            lines.append(line)
    for wallet in portfolio.wallets:
        lines.extend(_wallet_lines(wallet, max_positions))
    return "\n".join(lines)[:MAX_CHARS]
