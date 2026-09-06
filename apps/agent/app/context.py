"""What the model is told about the portfolio on screen.

Rebuilt from the public API on every turn and injected into the system prompt
rather than stored in the session: balances move between turns, and a
remembered number is a wrong number. Kept compact and capped — the model needs
the shape of the portfolio (totals, the positions that matter, the risk
figures), not every dust position; every character here is billed on every
turn of the conversation.
"""

from .config import settings

MAX_CHARS = 6000


def _usd(value) -> str:
    return f"${value:,.2f}" if isinstance(value, (int, float)) else "n/a"


def _position_line(position: dict) -> str:
    head = position.get("symbol") or "?"
    name = position.get("name")
    if name and name != head:
        head = f"{head} ({name})"
    bits = [_usd(position.get("valueUsd"))]
    apy = position.get("apy")  # a fraction: 0.42 is 42%
    if isinstance(apy, (int, float)):
        bits.append(f"APY {apy * 100:.1f}%")
    health = position.get("healthRate")
    if isinstance(health, (int, float)):
        bits.append(f"health {health:.2f}")
    borrow = position.get("borrowApy")
    if isinstance(borrow, (int, float)):
        bits.append(f"borrow {borrow * 100:.1f}%")
    if position.get("range"):
        bits.append(f"range {position['range']}")
    return f"{head}: {', '.join(bits)}"


def portfolio_context(data: dict) -> str:
    wallets = data.get("wallets") or []
    lines = [
        f'Portfolio "{data.get("name") or data.get("slug")}" — '
        f"total {_usd(data.get('totalUsd'))}, {len(wallets)} wallet(s)."
    ]
    for wallet in wallets:
        address = wallet.get("address") or "?"
        short = address if len(address) <= 14 else f"{address[:8]}…{address[-4:]}"
        stale = ", stale data" if wallet.get("stale") else ""
        lines.append(
            f"Wallet {short} [{wallet.get('chain')}] — {_usd(wallet.get('totalUsd'))}, "
            f"status {wallet.get('status')}{stale}:"
        )
        positions = sorted(
            wallet.get("positions") or [], key=lambda p: -(p.get("valueUsd") or 0)
        )
        cap = settings.context_max_positions
        for position in positions[:cap]:
            lines.append(f"  - {_position_line(position)}")
        rest = len(positions) - cap
        if rest > 0:
            lines.append(f"  - …and {rest} smaller positions")
    return "\n".join(lines)[:MAX_CHARS]
