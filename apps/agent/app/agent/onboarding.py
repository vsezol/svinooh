import logging
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import Runnable
from pydantic import BaseModel, Field

from ..config import Config
from ..domain.onboarding import Created, Refused
from .llm import Models, structured

logger = logging.getLogger("svinooh-ai")


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
    reason: str = Field(
        description=(
            "One short sentence, written BEFORE you choose: what the reply "
            "says about the proposal. Work it out here, then decide."
        )
    )
    decision: Literal["confirm", "cancel", "other"]


class ConfirmationClassifier:
    def __init__(self, models: Models, config: Config) -> None:
        self._models = models
        self._config = config

    async def classify(self, reply: str) -> ConfirmationDecision:
        messages = [SystemMessage(content=CONFIRMATION_PROMPT), HumanMessage(content=reply)]
        decision: ConfirmationDecision = await self._models.ask(
            self._config.labelling(), messages, prepare=_as_decision
        )
        return decision


def _as_decision(model: BaseChatModel) -> Runnable[Any, Any]:
    return structured(model, ConfirmationDecision)


async def create_portfolio_with_wallets(source, addresses: list[str], token: str | None) -> Created:
    anonymous = not token
    if anonymous:
        if not addresses:
            raise ValueError("an anonymous portfolio needs at least one address")
        slug = await source.create_anonymous_portfolio(addresses[0])
        seeded, rest = addresses[:1], addresses[1:]
    else:
        slug = await source.create_portfolio(token)
        seeded, rest = [], addresses
    added: list[str] = list(seeded)
    refused: list[Refused] = []
    for address in rest:
        try:
            await source.add_wallet(slug, address, token)
            added.append(address)
        except Exception as error:  # noqa: BLE001 — one bad address must not sink the rest
            logger.warning("add_wallet failed for %s: %r", address, error)
            refused.append(Refused(address=address, reason=str(error)))
    return Created(slug=slug, added=tuple(added), refused=tuple(refused), anonymous=anonymous)
