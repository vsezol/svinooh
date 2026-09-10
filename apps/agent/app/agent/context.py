"""What the model is told about the portfolio on screen.

Rebuilt from the public API on every turn and injected into the system prompt
rather than stored in the session: balances move between turns, and a
remembered number is a wrong number. Kept compact and capped — the model needs
the shape of the portfolio (totals, the positions that matter, the risk
figures), not every dust position; every character here is billed on every
turn of the conversation.

This module owns everything the model is told, including the system-prompt
variants the branches pick between — so "what do we say to the model" has
exactly one home. It renders, and computes nothing: the totals and the
groupings are the portfolio's own (app/domain/portfolio.py).
"""

from ..domain.onboarding import Created
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


def grounded_prompt(base: str, portfolio: Portfolio, max_positions: int) -> str:
    """The base prompt plus the live portfolio — the portfolio branch's happy path."""
    shown = portfolio_context(portfolio, max_positions)
    return f"{base}\n\nThe user is looking at this portfolio right now:\n{shown}"


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
    exist. Otherwise the conversation itself is the onboarding, signed in or
    not: the model collects wallet addresses and PROPOSES creation through the
    tool — the proposal is all it can do; the write happens only after the user
    confirms on a later turn (see app/agent/onboarding.py).

    What differs without an account is not whether a portfolio can be made but
    what is made: an ownerless one, which is public and which anybody holding
    the link can read. That is a thing to say before it exists, not after, so
    it is in the offer as well as in the confirmation.
    """
    if not signed_in:
        return (
            f"{base}\n\nThe user asks about their portfolio but is not signed "
            "in, so you cannot see any holdings. Say so plainly, and offer to "
            "track wallets right here without an account: ask for the wallet "
            "addresses (EVM 0x…, Solana, TRON or Bitcoin). Say plainly that a "
            "portfolio made this way belongs to nobody and is public — anyone "
            "with the link can see it — and that signing in later claims it. "
            "When — and only when — they have shared addresses and want to "
            "proceed, call the ProposePortfolio tool with the addresses "
            "exactly as written. Never invent or complete an address, and do "
            "not claim anything was created — they will be asked to confirm."
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


def confirmation_request_prompt(base: str, addresses: list[str], anonymous: bool) -> str:
    """Ask the user to confirm the proposed creation — the model phrases it.

    Phrased by the model rather than a template so the question lands in the
    user's own language; the addresses are injected verbatim so nothing is
    reworded where precision matters.

    Without an account the consent being asked for is a wider one, so the
    question says what it is: the portfolio will be public, and listing two
    addresses in it associates them in a place anybody can read. This is the
    turn where that has to be said — it is the last one before the write.
    """
    listed = "\n".join(f"- {address}" for address in addresses)
    caveat = ""
    if anonymous:
        caveat = (
            "\n\nThey have no account, so this portfolio will belong to "
            "nobody and be publicly visible: anyone with the link, or "
            "searching that address, can see it."
        )
        if len(addresses) > 1:
            caveat += (
                " Listing these wallets in one portfolio also shows publicly "
                "that they are held together."
            )
        caveat += " Say that plainly, and that signing in later claims it."
    return (
        f"{base}\n\nYou proposed creating a portfolio with these wallets:\n"
        f"{listed}{caveat}\n\nAsk the user, in their language, to confirm or "
        "decline (a plain yes/no). List the addresses exactly as above. Do not "
        "claim anything was created yet."
    )


def created_prompt(base: str, created: Created) -> str:
    """Tell the user what actually happened — including any address that failed."""
    added = "\n".join(f"- {address}" for address in created.added) or "- none"
    refused_lines = "\n".join(f"- {r.address}: {r.reason}" for r in created.refused)
    failure_note = f"\nThese were refused:\n{refused_lines}" if created.refused else ""
    # An ownerless portfolio is the one thing here a person can lose by not
    # acting: nobody holds it, so the link IS the only way back to it.
    claim_note = (
        "\n\nThis portfolio belongs to nobody and is public. Tell them to "
        "keep the link — it is the only way back to it — and that signing in "
        "claims it as theirs."
        if created.anonymous
        else ""
    )
    return (
        f"{base}\n\nThe portfolio was just created. Facts to relay, in the "
        f"user's language:\n- link: /p/{created.slug}\n"
        f"Wallets added:\n{added}{failure_note}{claim_note}\n\nTell them it "
        "is scanning now and they can ask about it here once the first sync "
        "lands. Relay failures honestly — do not soften a refused address "
        "into a success."
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
