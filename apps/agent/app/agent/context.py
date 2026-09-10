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

from ..config import context_max_positions

MAX_CHARS = 6000


def usd(value) -> str:
    return f"${value:,.2f}" if isinstance(value, (int, float)) else "n/a"


def short_address(address: str) -> str:
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


def _amount(value, price) -> str | None:
    """How much of it there is — the answer to "how much ETH do I have"."""
    if not isinstance(value, (int, float)) or value <= 0:
        return None
    figure = f"{value:,.4f}".rstrip("0").rstrip(".") if value < 1000 else f"{value:,.0f}"
    if isinstance(price, (int, float)) and price > 0:
        # Sub-cent prices are the rule in this asset class, not the exception,
        # and a token priced at 6e-08 must not print as "$0" — a zero price
        # next to a five-figure value is a contradiction the model is left to
        # resolve on its own.
        if price >= 0.01:
            shown = f"{price:,.2f}"
        elif price >= 1e-6:
            shown = f"{price:.8f}".rstrip("0").rstrip(".")
        else:
            shown = f"{price:.2e}"
        return f"{figure} @ ${shown}"
    return figure


def _where(position: dict) -> list[str]:
    """Which network, and which protocol if it is not simply held in the wallet.

    Both were missing from this block until a portfolio with a thousand
    positions made their absence obvious: without them, a question about Base
    or about Uniswap pools has nothing in the context to answer it, and an
    answer with nothing behind it is the kind that gets invented.
    """
    facts = []
    if _is_word(position.get("network")):
        facts.append(str(position["network"]))
    platform = position.get("platform")
    if _is_word(platform) and platform != "wallet":
        facts.append(str(platform))
    return facts


def _pair(position: dict) -> str | None:
    """The pool a liquidity position is in, and how far its band reaches.

    The pair sits in `band` and was dropped on the floor until a chat answered
    "what about my Uniswap pools" with "the pairs are not in the data" — while
    the pairs were, in fact, in the data.
    """
    band = position.get("band")
    if not isinstance(band, dict):
        return None
    pair = band.get("pair")
    if not _is_word(pair):
        return None
    fee = band.get("feePct")
    return f"{pair}" + (f" {fee}% fee" if isinstance(fee, (int, float)) else "")


def _composition(position: dict) -> str | None:
    """What a position is actually made of — supplied and borrowed legs."""
    tokens = position.get("tokens")
    if not isinstance(tokens, list) or not tokens:
        return None
    parts = []
    for leg in tokens[:6]:
        if not isinstance(leg, dict):
            continue
        symbol = leg.get("symbol") or "?"
        role = leg.get("role")
        amount = _amount(leg.get("amount"), leg.get("priceUsd"))
        piece = f"{symbol} {usd(leg.get('valueUsd'))}"
        if amount:
            piece += f" ({amount})"
        if _is_word(role) and role != "supply":
            piece = f"{role} {piece}"
        parts.append(piece)
    return " + ".join(parts) if parts else None


def position_line(position: dict, detail: bool = False) -> str:
    head = position.get("symbol") or "?"
    name = position.get("name")
    if name and name != head:
        head = f"{head} ({name})"
    pair = _pair(position)
    if pair:
        head = f"{head} [{pair}]"
    facts = [usd(position.get("valueUsd"))]
    amount = _amount(position.get("amount"), position.get("priceUsd"))
    if amount:
        facts.append(amount)
    facts.extend(_where(position))
    for key, usable, say in _POSITION_FACTS:
        value = position.get(key)
        if value is not None and usable(value):
            facts.append(say(value))
    line = f"{head}: {', '.join(facts)}"
    # Composition is long enough to crowd the standing block, so it belongs to
    # the drill-down that asked for detail.
    composition = _composition(position) if detail else None
    return f"{line} — {composition}" if composition else line


def _totals_by(positions: list[dict], key: str, skip: set[str] = frozenset()) -> list[tuple[str, float]]:
    """Value grouped by one field, largest first."""
    sums: dict[str, float] = {}
    for position in positions:
        label = position.get(key)
        value = position.get("valueUsd")
        if _is_word(label) and label not in skip and isinstance(value, (int, float)):
            sums[str(label)] = sums.get(str(label), 0.0) + value
    return sorted(sums.items(), key=lambda pair: -pair[1])


def _breakdown(label: str, totals: list[tuple[str, float]], total: float, limit: int = 8) -> str | None:
    """One line of "where the money is", with shares that add up."""
    if not totals:
        return None
    parts = []
    for name, value in totals[:limit]:
        share = f" ({value / total * 100:.0f}%)" if total else ""
        parts.append(f"{name} {usd(value)}{share}")
    if len(totals) > limit:
        rest = sum(value for _, value in totals[limit:])
        parts.append(f"+{len(totals) - limit} more {usd(rest)}")
    return f"{label}: {', '.join(parts)}"


def _wallet_lines(wallet: dict) -> list[str]:
    stale = ", stale data" if wallet.get("stale") else ""
    positions = sorted(wallet.get("positions") or [], key=lambda p: -(p.get("valueUsd") or 0))
    header = (
        f"Wallet {short_address(wallet.get('address') or '?')} "
        f"[{wallet.get('chain')}] — {usd(wallet.get('totalUsd'))}, "
        f"{len(positions)} position(s), status {wallet.get('status')}{stale}:"
    )
    # Largest first — sorted here, not trusted from the wire — so the cap below
    # can only ever drop the tail, which is dust by construction. (Wallets
    # themselves arrive value-sorted from the API; positions we order ourselves.)
    cap = context_max_positions()
    lines = [header] + [f"  - {position_line(p)}" for p in positions[:cap]]
    rest = positions[cap:]
    if rest:
        # The tail's value, not just its count: a model told only that 1004
        # positions exist will either ignore them or guess at them, and both
        # come out as a wrong total.
        carried = sum(p.get("valueUsd") or 0 for p in rest)
        lines.append(
            f"  - …and {len(rest)} smaller positions worth {usd(carried)} in total "
            "(ask for details on any of them with the position search tool)"
        )
    return lines


def portfolio_context(data: dict) -> str:
    wallets = data.get("wallets") or []
    positions = [p for w in wallets for p in (w.get("positions") or [])]
    total = data.get("totalUsd") if isinstance(data.get("totalUsd"), (int, float)) else 0.0
    lines = [
        f'Portfolio "{data.get("name") or data.get("slug")}" — '
        f"total {usd(data.get('totalUsd'))}, {len(wallets)} wallet(s), "
        f"{len(positions)} position(s)."
    ]
    # The shape of the money, computed over EVERY position rather than the few
    # the cap prints. These three lines are what make "where is my money by
    # chain" answerable without guessing, however long the tail is.
    for line in (
        _breakdown("By network", _totals_by(positions, "network"), total),
        _breakdown("By type", _totals_by(positions, "category"), total),
        _breakdown("In protocols", _totals_by(positions, "platform", skip={"wallet"}), total),
    ):
        if line:
            lines.append(line)
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


def onboarding_prompt(base: str, signed_in: bool) -> str:
    """For a portfolio question with no portfolio to ground in.

    One rule across both cases: never pretend to see holdings that do not
    exist. Signed in, the conversation itself is the onboarding: the model
    collects wallet addresses and PROPOSES creation through the tool — the
    proposal is all it can do; the write happens only after the user confirms
    on a later turn (see app/onboarding.py).
    """
    if not signed_in:
        return (
            f"{base}\n\nThe user asks about their portfolio but is not signed "
            "in, so you cannot see any holdings. Say that portfolio questions "
            "need sign-in (via Telegram in the svinooh app), then answer "
            "whatever general part of the question you can."
        )
    return (
        f"{base}\n\nThe user asks about their portfolio but does not own one "
        "yet, so there are no holdings to see. Say so plainly, and offer to "
        "create their first portfolio right here: ask them to share the wallet "
        "addresses to track (EVM 0x…, Solana, TRON or Bitcoin). When — and "
        "only when — they have shared addresses and want to proceed, call the "
        "ProposePortfolio tool with the addresses exactly as written. Never "
        "invent or complete an address, and do not claim anything was created "
        "— the user will be asked to confirm first."
    )


def confirmation_request_prompt(base: str, addresses: list[str]) -> str:
    """Ask the user to confirm the proposed creation — the model phrases it.

    Phrased by the model rather than a template so the question lands in the
    user's own language; the addresses are injected verbatim so nothing is
    reworded where precision matters.
    """
    listed = "\n".join(f"- {address}" for address in addresses)
    return (
        f"{base}\n\nYou proposed creating a portfolio with these wallets:\n"
        f"{listed}\n\nAsk the user, in their language, to confirm or decline "
        "(a plain yes/no). List the addresses exactly as above. Do not claim "
        "anything was created yet."
    )


def created_prompt(base: str, result: dict) -> str:
    """Tell the user what actually happened — including any address that failed."""
    added = "\n".join(f"- {address}" for address in result.get("added", [])) or "- none"
    failed = result.get("failed", [])
    failed_lines = "\n".join(f"- {f['address']}: {f['error']}" for f in failed)
    failure_note = f"\nThese were refused:\n{failed_lines}" if failed else ""
    return (
        f"{base}\n\nThe portfolio was just created. Facts to relay, in the "
        f"user's language:\n- link: /p/{result.get('slug', '')}\n"
        f"Wallets added:\n{added}{failure_note}\n\nTell them it is scanning "
        "now and they can ask about it here once the first sync lands. Relay "
        "failures honestly — do not soften a refused address into a success."
    )


def creation_failed_prompt(base: str) -> str:
    """The create call itself failed: nothing exists yet, and saying otherwise lies."""
    return (
        f"{base}\n\nCreating the portfolio just failed — nothing was created. "
        "Tell the user honestly, in their language, and that answering yes "
        "again in a moment will retry."
    )


def cancelled_prompt(base: str) -> str:
    return (
        f"{base}\n\nThe user declined the portfolio-creation proposal. "
        "Acknowledge briefly in their language — nothing was created — and "
        "offer to help with whatever else."
    )
