"""Intent classification — the router's eyes, live on the request path.

Structured output is the whole trick: instead of parsing prose, the model is
handed a schema (the pydantic class below) and must fill it — under the hood
LangChain turns the schema into a tool the model is forced to call, so what
comes back is a validated object, never a string to regex. This is the same
mechanism agent tools will use later; the classifier is its smallest lesson.

classify() raises on failure on purpose: the caller (the graph's classify
node) owns the failure policy — today that is "route to the portfolio branch",
which behaves exactly like pre-router code. The shadow wrapper that once stood
here is gone, as promised: it was the rollout mode, not the operation.
"""
from functools import cache
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from .llm import budget_was_refused, drop_budget, get_router_model, labelling_model

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
    messages = [SystemMessage(content=CLASSIFIER_PROMPT), HumanMessage(content=question)]
    try:
        return await _labeler().ainvoke(messages)
    except Exception as error:  # noqa: BLE001 — one specific cause is recoverable
        # An endpoint that mandates reasoning rejects the budget we asked for,
        # and every classification fails for as long as the setting stands.
        # Drop the budget once and try again; a second failure is a real one.
        if not (budget_was_refused(error) and drop_budget(labelling_model())):
            raise
        _labeler.cache_clear()
        return await _labeler().ainvoke(messages)
