from dataclasses import replace

from ..domain.conversation import Turn
from ..domain.earn import Held
from ..domain.portfolio import Portfolio, Position, Total, Wallet, total_of

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


def _amount(amount: float | None, price: float | None) -> str | None:
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
        amount = _amount(leg.amount, leg.price_usd)
        if amount:
            piece += f" ({amount})"
        if leg.apy is not None:
            piece += f" at {rate(leg.apy)}"
        if leg.role and leg.role != "supply":
            piece = f"{leg.role} {piece}"
        parts.append(piece)
    return " + ".join(parts) if parts else None


def positions_read(portfolio: Portfolio, name_at_most: int = 3) -> str:
    if not portfolio.positions:
        return "nothing held"
    held = f"{len(portfolio.positions)} positions"
    networks = sorted({p.network for p in portfolio.positions if p.network})
    if not networks:
        return held
    named = ", ".join(networks[:name_at_most])
    left = len(networks) - name_at_most
    return f"{held} · {named}{f' +{left}' if left > 0 else ''}"


def idle_lines(portfolio: Portfolio, limit: int = 10) -> str:
    idle = sorted(
        (p for p in portfolio.positions if _is_idle(p)),
        key=lambda p: p.value_usd,
        reverse=True,
    )
    if not idle:
        return "nothing idle — everything is already placed or is collateral."
    return "\n".join(_idle_line(p) for p in idle[:limit])


def _is_idle(position: Position) -> bool:
    return position.category == "token" and not _pays_something(position)


def _idle_line(position: Position) -> str:
    held = _amount(position.amount, position.price_usd)
    figure = f"{held} = {usd(position.value_usd)}" if held else usd(position.value_usd)
    where = f" on {position.network}" if position.network else ""
    return f"- {named(position.symbol, 'unnamed token')} {figure}{where}"


def earning_lines(portfolio: Portfolio, limit: int = 10) -> str:
    earning = sorted(
        (p for p in portfolio.positions if _pays_something(p)),
        key=lambda p: p.value_usd,
        reverse=True,
    )
    return "\n".join(_earning_line(p) for p in earning[:limit])


def _pays_something(position: Position) -> bool:
    if position.apy and position.apy > 0:
        return True
    return any(leg.apy and leg.apy > 0 for leg in position.earning_legs)


def _earning_line(position: Position) -> str:
    symbol = named(position.symbol, UNNAMED_POSITION)
    name = f"{symbol}{f' ({position.name})' if position.name else ''}"
    head = f"- {name} on {position.protocol or 'wallet'}: {usd(position.value_usd)}"
    supplied = _supplied_at(position)
    body = f"— {supplied}" if supplied else _rate_of(position)
    return f"{head} {body}{_owed_against(position)}"


def _rate_of(position: Position) -> str:
    return f"at {rate(position.apy)}" if position.apy is not None else "no rate given"


def _supplied_at(position: Position, limit: int = 4) -> str:
    legs = sorted(position.earning_legs, key=lambda leg: leg.value_usd, reverse=True)
    if not legs:
        return ""
    quoted = ", ".join(
        f"{named(leg.symbol, UNNAMED_TOKEN)} {usd(leg.value_usd)} at {rate(leg.apy or 0)}"
        for leg in legs[:limit]
    )
    return f"supplied {quoted}"


def _owed_against(position: Position) -> str:
    if not position.has_debt:
        return ""
    owed = [leg for leg in position.legs if leg.role == "borrow"]
    borrowed = ", ".join(
        f"{named(leg.symbol, UNNAMED_TOKEN)} {usd(abs(leg.value_usd))}" for leg in owed[:3]
    )
    cost = f" at {rate(position.borrow_apy)}" if position.borrow_apy else ""
    health = f", health {position.health_rate:.2f}" if position.health_rate else ""
    debt = f"borrowed {borrowed}{cost}{health}" if borrowed else f"a loan{cost}{health}"
    return (
        f"; {debt}. This is collateral for that loan, not idle money: it cannot be moved "
        "before the loan is repaid, and taking part of it out lowers the health factor."
    )


def position_line(position: Position, detail: bool = False) -> str:
    head = named(position.symbol, UNNAMED_POSITION)
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
    composition = _composition(position) if detail else None
    return f"{line} — {composition}" if composition else line


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


def held_lines(held: tuple[Held, ...]) -> str:
    """What they have in pools money can be taken out of, each with the id to take it by."""
    return "\n".join(
        f"- {one.amount:f} {one.pool.token} in {one.pool.name} ({one.pool.protocol} "
        f"{one.pool.kind}) paying {one.pool.apy_net * 100:.2f}% net. id {one.pool.id}"
        for one in sorted(held, key=lambda one: -one.amount)
    )


NOBODY_TYPED = "(the wallet reported back on what they signed)"

_ACTIONS = {"deposit": "a deposit", "withdraw": "a withdrawal", "move": "a move"}


def replayed(turn: Turn) -> tuple[str, str]:
    """A past turn as the models are shown it: what was said, and what was on screen.

    The stored answer is only the words. The question the assistant put up
    with buttons, and the card it prepared, were the rest of the answer — and
    without them "Risk: low" arrives answering a question the model cannot see
    it asked. A turn the user did not type, a deposit coming back, is said to
    be one, so no message goes to a model empty.
    """
    shown = [line for line in (_on_screen(block) for block in turn.blocks) if line]
    said = " ".join(part for part in (turn.a, *shown) if part)
    return turn.q or NOBODY_TYPED, said or "(nothing was said)"


def _on_screen(block: dict) -> str | None:
    kind = block.get("kind")
    if kind == "choice":
        options = " / ".join(str(option) for option in block.get("options", []))
        return f"(asked with buttons — {block.get('question')} Options: {options})"
    if kind == "deposit":
        what = _ACTIONS.get(str(block.get("action") or "deposit"), "a deposit")
        amount = block.get("shown") or block.get("amount")
        route = (
            f"from {block.get('fromPool')} into {block.get('pool')}"
            if block.get("fromPool")
            else f"{'out of' if block.get('action') == 'withdraw' else 'into'} {block.get('pool')}"
        )
        return f"(put {what} of {amount} {block.get('token')} {route} on screen for them to sign)"
    return None


def without_what_the_chain_read(
    portfolio: Portfolio, read: dict[str, tuple[Held, ...]]
) -> Portfolio:
    """The portfolio less the positions the chain was just read for, wallet by wallet.

    The scanner reports a vault share staked in its farm as a protocol position
    of its own — "Kamino Farming, $12" — while the chain read names the vault.
    Both is one sum of money counted twice: on 2026-09-21 the agent offered to
    move "USDC Prime" and "Kamino Farming", and "both", for twelve dollars.
    They are told apart by the shares: the scanner's position carries them as
    a supply leg, the chain read counts them, and the same count on the same
    protocol is the same money. A position that holds other shares, or owes
    something, is not this one, and stays.
    """
    return replace(
        portfolio,
        wallets=tuple(
            replace(
                wallet,
                positions=tuple(
                    position
                    for position in wallet.positions
                    if not _read_already(position, read.get(wallet.address, ()))
                ),
            )
            for wallet in portfolio.wallets
        ),
    )


SAME_SHARES = 0.001


def _read_already(position: Position, held: tuple[Held, ...]) -> bool:
    protocol = (position.platform or "").lower()
    here = [one for one in held if one.pool.protocol.lower() == protocol]
    if not here or position.has_debt:
        return False
    if not position.legs:
        return True
    counted = [float(one.shares) for one in here if one.shares]
    return any(
        leg.role == "supply"
        and leg.amount is not None
        and any(abs(leg.amount - shares) <= shares * SAME_SHARES for shares in counted)
        for leg in position.legs
    )
