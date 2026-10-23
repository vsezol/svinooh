from dataclasses import replace
from decimal import Decimal

from svinooh_portfolio.format import UNNAMED_POSITION, UNNAMED_TOKEN, amount_at, named, rate, usd
from svinooh_portfolio.portfolio import Portfolio, Position

from ..domain.conversation import Turn
from ..domain.earn import Held, LiquidityPosition


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


GAS_KEPT = 0.02
"""SOL left in a wallet for what signing costs: the fee, and the rent a deposit locks."""


def free_on_solana(portfolio: Portfolio) -> dict[str, Decimal]:
    """What the Solana wallets hold free, by ticker: the idle lines as figures, SOL less its gas."""
    free: dict[str, Decimal] = {}
    for position in portfolio.positions:
        if not _is_idle(position) or (position.network or "").lower() != "sol":
            continue
        amount = _spare(position) if _is_gas(position) else (position.amount or 0.0)
        symbol = position.symbol.upper()
        free[symbol] = free.get(symbol, Decimal(0)) + Decimal(str(amount))
    return free


def _is_idle(position: Position) -> bool:
    if position.category != "token" or _pays_something(position):
        return False
    return not _is_gas(position) or _spare(position) > 0


def _is_gas(position: Position) -> bool:
    return position.symbol.upper() == "SOL" and (position.network or "").lower() == "sol"


def _spare(position: Position) -> float:
    return max((position.amount or 0.0) - GAS_KEPT, 0.0)


def _idle_line(position: Position) -> str:
    """One idle holding, as much of it as can go into a pool.

    Native SOL is the gas the wallet signs with. Offering all of it put a
    deposit in front of somebody that would have left them unable to sign it —
    and a wallet with nothing left over cannot sign anything after either.
    """
    if _is_gas(position):
        spare = _spare(position)
        value = spare * position.price_usd if position.price_usd else None
        figure = f"SOL {amount_at(spare, position.price_usd)}"
        worth = f" = {usd(value)}" if value is not None else ""
        return f"- {figure}{worth} on sol ({GAS_KEPT} SOL more is kept back for network fees)"
    held = amount_at(position.amount, position.price_usd)
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


def held_lines(held: tuple[Held, ...]) -> str:
    """What they have in pools money can be taken out of, each with the id to take it by."""
    return "\n".join(
        f"- {one.amount:f} {one.pool.token} in {one.pool.name} ({one.pool.protocol} "
        f"{one.pool.kind}) paying {one.pool.apy_net * 100:.2f}% net. id {one.pool.id}"
        for one in sorted(held, key=lambda one: -one.amount)
    )


NOBODY_TYPED = "(the wallet reported back on what they signed)"

_ACTIONS = {"deposit": "a deposit", "withdraw": "a withdrawal", "move": "a move"}

_LIQUIDITY = {"provide": "liquidity", "close": "the closing", "rebalance": "a rebalance"}


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
    if kind == "deposit" and block.get("action") in _LIQUIDITY:
        span = (
            f" across -{block.get('belowPct')}% / +{block.get('abovePct')}%"
            if block.get("belowPct")
            else ""
        )
        if block.get("action") == "provide":
            spent = _symbol(block.get("payWith")) or block.get("token")
            return (
                f"(put liquidity of {block.get('amount')} {spent} into {block.get('pool')}{span} "
                "on screen for them to sign)"
            )
        return (
            f"(put {_LIQUIDITY[str(block.get('action'))]} of their {block.get('pool')} position "
            f"{block.get('position')}{span} on screen for them to sign)"
        )
    if kind == "deposit":
        what = _ACTIONS.get(str(block.get("action") or "deposit"), "a deposit")
        amount = block.get("shown") or block.get("amount")
        route = (
            f"from {block.get('fromPool')} into {block.get('pool')}"
            if block.get("fromPool")
            else f"{'out of' if block.get('action') == 'withdraw' else 'into'} {block.get('pool')}"
        )
        spent = _symbol(block.get("payWith")) or block.get("fromToken") or block.get("token")
        ends = _symbol(block.get("receiveAs")) or block.get("token")
        swapped = f", swapped to {ends}" if ends != spent else ""
        return f"(put {what} of {amount} {spent} {route}{swapped} on screen for them to sign)"
    return None


def _symbol(coin: object) -> str | None:
    return str(coin.get("symbol")) if isinstance(coin, dict) and coin.get("symbol") else None


def placed_lines(placed: tuple[LiquidityPosition, ...]) -> str:
    """Their liquidity positions: where the price stands, and the address to act on each by."""
    return "\n".join(_placed_line(one) for one in sorted(placed, key=lambda one: -one.value_usd))


def _placed_line(one: LiquidityPosition) -> str:
    pool = one.pool
    state = "in range, earning." if one.in_range else "OUT OF RANGE, earning nothing."
    return (
        f"- {pool.name} on Meteora (bins {pool.bin_step / 100:g}% apart): "
        f"{one.amount_x:f} {pool.x} and {one.amount_y:f} {pool.y}, "
        f"{usd(float(one.value_usd))}, fees earned {usd(float(one.fees_usd))}. "
        f"Range {one.lower_price:f} to {one.upper_price:f} {pool.y} per {pool.x}, "
        f"price {pool.price:f} — {state} position {one.address}, pool id {pool.id}"
    )


def without_what_the_chain_read(
    portfolio: Portfolio, read: dict[str, tuple[Held, ...]], placed: bool = False
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
                    and not (placed and (position.platform or "").lower() == "meteora")
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
