"""What the model is told about the portfolio on screen.

Rebuilt from the public API on every turn and injected into the system prompt
rather than stored in the session: balances move between turns, and a
remembered number is a wrong number. Kept compact and capped — the model needs
the shape of the portfolio (totals, the positions that matter, the risk
figures), not every dust position; every character here is billed on every
turn of the conversation.

This module owns everything the model is told, including the two system-prompt
variants the portfolio branch picks between — so "what do we say to the model"
has exactly one home.
"""
from collections.abc import Callable

from .config import settings

MAX_CHARS = 6000


def _usd(value) -> str:
    return f"${value:,.2f}" if isinstance(value, (int, float)) else "n/a"


def _short_address(address: str) -> str:
    return address if len(address) <= 14 else f"{address[:8]}…{address[-4:]}"


def _is_number(value) -> bool:
    return isinstance(value, (int, float))


def _is_word(value) -> bool:
    return isinstance(value, str) and bool(value)


# One row per fact a position may carry: (source key, is it usable, how to say
# it). The renderer walks this table, so teaching the context a new fact is one
# entry here rather than another if-branch. The two rates arrive as fractions
# (0.42 is 42%); range is a plain word ("in"/"out").
_POSITION_FACTS: list[tuple[str, Callable[[object], bool], Callable[[object], str]]] = [
    ("apy", _is_number, lambda v: f"APY {v * 100:.1f}%"),
    ("healthRate", _is_number, lambda v: f"health {v:.2f}"),
    ("borrowApy", _is_number, lambda v: f"borrow {v * 100:.1f}%"),
    ("range", _is_word, lambda v: f"range {v}"),
]


def _position_line(position: dict) -> str:
    head = position.get("symbol") or "?"
    name = position.get("name")
    if name and name != head:
        head = f"{head} ({name})"
    facts = [_usd(position.get("valueUsd"))]
    for key, usable, say in _POSITION_FACTS:
        value = position.get(key)
        if value is not None and usable(value):
            facts.append(say(value))
    return f"{head}: {', '.join(facts)}"


def _wallet_lines(wallet: dict) -> list[str]:
    stale = ", stale data" if wallet.get("stale") else ""
    header = (
        f"Wallet {_short_address(wallet.get('address') or '?')} "
        f"[{wallet.get('chain')}] — {_usd(wallet.get('totalUsd'))}, "
        f"status {wallet.get('status')}{stale}:"
    )
    # Largest first — sorted here, not trusted from the wire — so the cap below
    # can only ever drop the tail, which is dust by construction. (Wallets
    # themselves arrive value-sorted from the API; positions we order ourselves.)
    positions = sorted(wallet.get("positions") or [], key=lambda p: -(p.get("valueUsd") or 0))
    cap = settings.context_max_positions
    lines = [header] + [f"  - {_position_line(p)}" for p in positions[:cap]]
    rest = len(positions) - cap
    if rest > 0:
        lines.append(f"  - …and {rest} smaller positions")
    return lines


def portfolio_context(data: dict) -> str:
    wallets = data.get("wallets") or []
    lines = [
        f'Portfolio "{data.get("name") or data.get("slug")}" — '
        f"total {_usd(data.get('totalUsd'))}, {len(wallets)} wallet(s)."
    ]
    for wallet in wallets:
        lines.extend(_wallet_lines(wallet))
    return "\n".join(lines)[:MAX_CHARS]


def grounded_prompt(base: str, data: dict) -> str:
    """The base prompt plus the live portfolio — the portfolio branch's happy path."""
    return f"{base}\n\nThe user is looking at this portfolio right now:\n{portfolio_context(data)}"


def degraded_prompt(base: str) -> str:
    """When the portfolio API did not answer: say so, so the model does not guess."""
    return (
        f"{base}\n\n(Live portfolio data could not be fetched for this turn — "
        "answer generally, and say the live numbers are unavailable if asked "
        "about them.)"
    )
