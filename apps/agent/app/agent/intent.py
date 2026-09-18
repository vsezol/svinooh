"""Intent classification — the router's eyes, live on the request path.

Structured output is the whole trick: the model is handed a schema and must
fill it, so what comes back is a validated object and never a string to
regex. It is asked for as a tool call the model must make (llm.structured),
the same mechanism the agent's own tools use.

`classify` raises only when there is no way left to get a label. The graph
owns that failure policy — route to the portfolio branch — but it is a poor
thing to fall back on: not "no answer" but a confident wrong turn on every
question. So this exhausts its options first.
"""

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
    "in whatever language they ask. Label `general` for everything else: DeFi "
    "concepts, how the app works, small talk. When in doubt, prefer "
    "`portfolio` — a wrong general answer to a money question costs more than "
    "a wasted context fetch."
)


class IntentLabel(BaseModel):
    intent: Literal["portfolio", "general"]
    reason: str = Field(description="One short sentence: why this label.")


class IntentClassifier:
    """Labels a question, on the cheap model when it can be reached.

    The labelling model is chosen for being cheap, and a cheap model is the
    kind that turns out not to be servable: fewer providers, likelier to fail
    a policy we hold. Twice that produced a router failing on every request
    while the product looked fine. So an unreachable labelling model costs
    one wasted call, and the answering model does the labelling instead.
    """

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
