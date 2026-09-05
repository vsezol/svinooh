"""Intent classification — the router's eyes, currently in shadow mode (D7).

Structured output is the whole trick: instead of parsing prose, the model is
handed a schema (the pydantic class below) and must fill it — under the hood
LangChain turns the schema into a tool the model is forced to call, so what
comes back is a validated object, never a string to regex. This is the same
mechanism agent tools will use later; the classifier is its smallest lesson.

Shadow mode: every real turn is labeled and logged, and nothing acts on the
label yet. A classifier earns the right to steer traffic by being watched in
the logs first — when the labels look right, R2 wires them into the graph.
"""
import logging
from functools import cache
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .llm import get_router_model

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


@cache  # lazy singleton: built on the first call, reused ever after
def _labeler():
    # The model is forced to answer in the schema's shape; .with_structured_output
    # returns a runnable that yields IntentLabel instances directly.
    return get_router_model().with_structured_output(IntentLabel)


async def classify(question: str) -> IntentLabel:
    return await _labeler().ainvoke(
        [SystemMessage(content=CLASSIFIER_PROMPT), HumanMessage(content=question)]
    )


async def classify_shadow(question: str, session_id: str) -> None:
    """Label a turn for the logs, and only the logs.

    The split with classify() is operation vs rollout mode: classify() is the
    real thing — returns the label, raises on failure — and it is what R2 will
    call on the request path once labels steer routing. This wrapper exists
    only for the shadow phase: same call, plus logging, minus every exception —
    the "never raises, returns nothing" contract is what makes fire-and-forget
    safe. When R2 lands, this wrapper is deleted and classify() stays.
    """
    try:
        label = await classify(question)
        logger.info(
            "intent shadow: %s (%s) session=%s q=%.80s",
            label.intent, label.reason, session_id, question,
        )
    except Exception as error:  # noqa: BLE001 — see the docstring
        logger.warning("intent shadow failed: %r session=%s", error, session_id)
