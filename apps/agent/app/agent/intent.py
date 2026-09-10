"""Intent classification — the router's eyes, live on the request path.

Structured output is the whole trick: instead of parsing prose, the model is
handed a schema (the pydantic class below) and must fill it, so what comes back
is a validated object and never a string to regex. We ask for that as a tool
call the model must make — see llm.structured for why that particular way, and
why leaving the choice to the library cost us the classifier. It is the same
mechanism the agent's own tools use; the classifier is its smallest lesson.

classify() raises only when there is no way left to get a label. The caller
(the graph's classify node) owns that failure policy — "route to the portfolio
branch" — but it is a poor thing to fall back on, because it is not "no
answer", it is a confident wrong turn taken on every question. So this module
exhausts its options first.
"""

import logging
from functools import cache
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from ..composition import config
from .llm import ask, get_model, get_router_model, structured

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
    # The model is forced to answer in the schema's shape, as a tool call it
    # must make; the runnable yields IntentLabel instances directly.
    return structured(get_router_model(), IntentLabel)


@cache
def _understudy():
    """The same job on the model that answers — the one we know is reachable."""
    return structured(get_model(), IntentLabel)


async def classify(question: str) -> IntentLabel:
    """Label the question, on the cheap model if it can be reached.

    The labelling model is chosen for being cheap and quick, and a cheap model
    is exactly the kind that turns out not to be servable: it lives on fewer
    providers, and the ones it has are likelier to fail a policy we hold — ours
    refuse to be trained on, because these prompts carry wallet addresses.

    Twice now that produced a router which failed on every single request while
    the product looked fine, because the fallback for "no label" is a label. So
    a labelling model we cannot reach costs one wasted call and the answering
    model does the labelling, rather than costing every question its routing.
    The warning is loud because this is a configuration mistake, not weather.
    """
    messages = [SystemMessage(content=CLASSIFIER_PROMPT), HumanMessage(content=question)]
    try:
        return await ask(_labeler, messages, config.labelling(), _labeler.cache_clear)
    except Exception as error:
        if config.labelling().model == config.answering().model:
            raise
        logger.warning(
            "labelling model %s unusable (%r) — labelling on %s instead",
            config.labelling().model,
            error,
            config.answering().model,
        )
        return await ask(_understudy, messages, config.answering(), _understudy.cache_clear)
