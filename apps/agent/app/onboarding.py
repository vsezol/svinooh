"""Conversational onboarding — the agent's first write (DESIGN.md, "onboarding
is the agent's first write, and writes are confirmed").

The write is gated by construction, not by prompt. The model can only PROPOSE:
calling the tool below stores the addresses as the session's pending action and
the user is asked to confirm. The actual POSTs happen on a LATER turn, and only
after the confirmation classifier reads a clear yes — so no single model output
can ever reach the write path on its own. That two-phase shape is the
human-in-the-loop pattern this module exists to teach.
"""
import logging
from functools import cache
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .llm import get_router_model

logger = logging.getLogger("svinooh-ai")

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
    return get_router_model().with_structured_output(ConfirmationDecision)


async def classify_confirmation(reply: str) -> ConfirmationDecision:
    return await _confirmation_labeler().ainvoke(
        [SystemMessage(content=CONFIRMATION_PROMPT), HumanMessage(content=reply)]
    )


async def execute_creation(source, addresses: list[str], token: str) -> dict:
    """Create the portfolio and add every address, through the public API.

    Two failure grades on purpose. The portfolio POST failing fails the whole
    action (nothing was created — the caller keeps the pending proposal so a
    later yes can retry). A single wallet failing does NOT: the portfolio
    exists, the rest were added, and the result says exactly which address was
    refused and why — the honest partial outcome, not all-or-nothing theater.
    """
    created = await source.create_portfolio(token)
    slug = created.get("slug", "")
    added: list[str] = []
    failed: list[dict] = []
    for address in addresses:
        try:
            await source.add_wallet(slug, address, token)
            added.append(address)
        except Exception as error:  # noqa: BLE001 — one bad address must not sink the rest
            logger.warning("add_wallet failed for %s: %r", address, error)
            failed.append({"address": address, "error": str(error)})
    return {"slug": slug, "added": added, "failed": failed}
