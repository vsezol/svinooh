import logging
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.runnables import Runnable
from pydantic import BaseModel, Field

from ..config import Config
from .llm import Models, structured

logger = logging.getLogger("svinooh-ai")

CLASSIFIER_PROMPT = (
    "You label questions asked to the assistant of svinooh, a DeFi portfolio "
    "tracker. Label `portfolio` when the user asks about their own money — "
    "their portfolio, wallets, positions, balance, history, yields, health "
    "factor, debt, or what changed ('my portfolio', 'how much do I have') — "
    "in whatever language they ask. Label `earn` when the user asks where to "
    "PUT money rather than what they already hold: where to invest, park, "
    "deposit, lend or earn, what rates are on offer, what to do with idle "
    "funds. `earn` wins even when they say 'my' — 'put my USDC to work' is "
    "asking where to put it, not what it is worth. Label `general` for "
    "everything else: DeFi concepts, how the app works, small talk. When in "
    "doubt between portfolio and general, prefer `portfolio` — a wrong general "
    "answer to a money question costs more than a wasted context fetch."
)


class IntentLabel(BaseModel):
    intent: Literal["portfolio", "earn", "general"]
    reason: str = Field(description="One short sentence: why this label.")
    asked_to_place: bool = Field(
        default=False,
        description=(
            "For `earn` only. True when the user is asking US to put the money "
            "somewhere — 'put my USDC to work', 'invest 500 for me', 'do it', "
            "'move it to the best one'. False when they are asking what the "
            "options are, what pays what, or where one could invest. In doubt, "
            "false: telling somebody what their choices are is never the wrong "
            "answer to a request to act, and acting on a question is."
        ),
    )


class IntentClassifier:
    def __init__(self, models: Models, config: Config) -> None:
        self._models = models
        self._config = config

    async def classify(self, question: str) -> IntentLabel:
        messages = [SystemMessage(content=CLASSIFIER_PROMPT), HumanMessage(content=question)]
        labelling, answering = self._config.labelling(), self._config.answering()
        try:
            label: IntentLabel = await self._models.ask(labelling, messages, prepare=_as_label)
        except Exception as error:
            if labelling.model == answering.model:
                raise
            logger.warning(
                "labelling model %s unusable (%r) — labelling on %s instead",
                labelling.model,
                error,
                answering.model,
            )
            label = await self._models.ask(answering, messages, prepare=_as_label)
        return label


def _as_label(model: BaseChatModel) -> Runnable[Any, Any]:
    return structured(model, IntentLabel)
