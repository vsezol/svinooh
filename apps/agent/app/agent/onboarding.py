"""Conversational onboarding — the agent's first write (DESIGN.md, "onboarding
is the agent's first write, and writes are confirmed").

The write is gated by construction, not by prompt. The model can only PROPOSE:
calling the tool below stores the addresses as the session's pending action and
the user is asked to confirm. The actual POSTs happen on a LATER turn, and only
after the confirmation classifier reads a clear yes — so no single model output
can ever reach the write path on its own. That two-phase shape is the
human-in-the-loop pattern this module exists to teach.

This module is ONE action end to end, in its three phases: the proposal tool
(what the model can say), the confirmation classifier (how a reply is read),
the execution (what actually hits the API). The graph only orchestrates these.
When the agent grows a second action, this file becomes actions/<name>.py —
one module per action, each in this same three-phase shape.
"""

import logging
from functools import cache
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from ..composition import config
from .llm import ask, get_router_model, structured

logger = logging.getLogger("svinooh-ai")

# ── phase 1: the proposal tool — the only thing the model can "do" ─────────

# More than a person plausibly pastes in a chat, fewer than a paste-bomb.
MAX_ADDRESSES = 10


class ProposePortfolio(BaseModel):
    """Propose creating the user's first portfolio from wallet addresses.

    Call this ONLY when the user has explicitly shared wallet addresses in the
    conversation and wants a portfolio created from them. Pass the addresses
    exactly as the user wrote them — never invent, complete, or correct one.
    """

    addresses: list[str] = Field(
        description="The wallet addresses the user shared, verbatim (EVM 0x…, SOL, TRON or BTC)."
    )


def sanitize_addresses(raw: list[str]) -> list[str]:
    """Trim, drop empties, dedupe (order kept), cap.

    Real validation is the API's job on execution — it knows which chains
    exist; this only keeps the proposal honest in size and shape.
    """
    seen: set[str] = set()
    clean: list[str] = []
    for item in raw:
        address = str(item).strip()
        if address and address not in seen:
            seen.add(address)
            clean.append(address)
    return clean[:MAX_ADDRESSES]


# ── phase 2: the confirmation classifier — how the user's reply is read ────

CONFIRMATION_PROMPT = (
    "The assistant proposed creating a portfolio from wallet addresses and "
    "asked the user to confirm. Classify the user's reply, in whatever "
    "language it is written: `confirm` — a clear yes / go ahead; `cancel` — a "
    "clear no / decline; `other` — anything else (a question, changed "
    "addresses, an unrelated message)."
)


class ConfirmationDecision(BaseModel):
    decision: Literal["confirm", "cancel", "other"]
    reason: str = Field(description="One short sentence: why this label.")


@cache
def _confirmation_labeler():
    return structured(get_router_model(), ConfirmationDecision)


async def classify_confirmation(reply: str) -> ConfirmationDecision:
    messages = [SystemMessage(content=CONFIRMATION_PROMPT), HumanMessage(content=reply)]
    return await ask(
        _confirmation_labeler, messages, config.labelling(), _confirmation_labeler.cache_clear
    )


# ── phase 3: the execution — what actually hits the API, after the yes ─────


async def create_portfolio_with_wallets(source, addresses: list[str], token: str | None) -> dict:
    """Create the portfolio and add every address, through the public API.

    Two failure grades on purpose. The portfolio POST failing fails the whole
    action (nothing was created — the caller keeps the pending proposal so a
    later yes can retry). A single wallet failing does NOT: the portfolio
    exists, the rest were added, and the result says exactly which address was
    refused and why — the honest partial outcome, not all-or-nothing theater.

    Two doors, one action. With a token the portfolio is created owned, empty,
    and every address is added to it. Without one it goes through the host's
    ownerless door, which differs in a way that matters here: that POST takes
    the FIRST address and returns a portfolio already holding it — find-or-
    create, so a wallet somebody already opened anonymously is joined rather
    than duplicated. The remaining addresses are added exactly as above, with
    no token, because an ownerless portfolio accepts a wallet from anyone.

    `anonymous` in the result is what the caller relays: a portfolio that
    belongs to nobody is public and claimable, and a person should be told
    that before they treat it as theirs.
    """
    # Falsy, not `is None`: an empty header is a caller with no token, and
    # the rest of the graph already reads absent-or-empty the same way.
    anonymous = not token
    if anonymous:
        if not addresses:
            # The owned door can make an empty portfolio and the person can
            # fill it later; the ownerless one is opened BY an address, so
            # there is nothing to open here. Fail the action rather than
            # inventing a wallet — the caller relays this as "nothing created".
            raise ValueError("an anonymous portfolio needs at least one address")
        # The first address is spent on the create and is therefore already in.
        created = await source.create_anonymous_portfolio(addresses[0])
        seeded, rest = addresses[:1], addresses[1:]
    else:
        created = await source.create_portfolio(token)
        seeded, rest = [], addresses
    slug = created.get("slug", "")
    added: list[str] = list(seeded)
    failed: list[dict] = []
    for address in rest:
        try:
            await source.add_wallet(slug, address, token)
            added.append(address)
        except Exception as error:  # noqa: BLE001 — one bad address must not sink the rest
            logger.warning("add_wallet failed for %s: %r", address, error)
            failed.append({"address": address, "error": str(error)})
    return {"slug": slug, "added": added, "failed": failed, "anonymous": anonymous}
