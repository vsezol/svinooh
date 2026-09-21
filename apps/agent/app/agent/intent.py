import logging
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import Runnable
from pydantic import BaseModel, Field

from ..config import Config
from ..domain.conversation import Turn
from .context import replayed
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
    "funds — and when they want money taken OUT of a pool or moved from one "
    "pool to another. `earn` wins even when they say 'my' — 'put my USDC to "
    "work' is asking where to put it, and 'move my USDC somewhere that pays "
    "more' is asking where to move it, not what it is worth. Label `general` for "
    "everything else: DeFi concepts, how the app works, small talk. When in "
    "doubt between portfolio and general, prefer `portfolio` — a wrong general "
    "answer to a money question costs more than a wasted context fetch.\n"
    "\n"
    "What came before decides what the latest line means. An answer to a "
    "question the assistant just asked carries that question's intent: after "
    "'which token and how much?', 'all my USDC' is the user placing money, "
    "not asking what they hold. Label the conversation, not the line."
)

RECENT_TURNS = 2


class IntentLabel(BaseModel):
    reason: str = Field(
        description=(
            "One short sentence, written BEFORE you choose: what the user is "
            "after, and what the line before it was about. Work it out here, "
            "then label."
        )
    )
    language: str = Field(
        description=(
            "The language the user's last message is written in, named in "
            "English in one word — Russian, Ukrainian, English, Spanish. Name "
            "the language of the words they typed, not the language of what "
            "they are asking about."
        )
    )
    intent: Literal["portfolio", "earn", "general"]
    stance: Literal["asking", "placing"] = Field(
        description=(
            "What they want done with money, for `earn`. `placing` when they "
            "tell you to put it somewhere, take it out or move it — 'put my "
            "USDC to work', 'invest 500 for me', 'закинь', 'выведи', 'переложи "
            "повыгоднее', 'do it', 'all of it' — and also when they only name "
            "an amount or a pool after you asked which. `asking` when they "
            "want to know what the options are or what a rate is. For "
            "`portfolio` and `general` say `asking`. Say one of the two words "
            "every time; there is no default."
        )
    )
    risk: Literal["low", "medium", "high", "unknown"] = Field(
        description=(
            "How much risk the user has said they want, anywhere in this "
            "conversation: `low` for safe, reliable, conservative, "
            "'надёжный', 'безопасный', 'спокойно', 'низкий'; `high` for the "
            "highest rate, risky, aggressive, 'максимум', 'рискованно', "
            "'высокий'; `medium` for something between. A button they pressed "
            "that names a band counts as saying it. A wish for a better rate "
            "is not a risk: 'повыгоднее', 'more profitable', 'the best' are "
            "`unknown`. Say `unknown` whenever they have not said it."
        )
    )


class IntentClassifier:
    def __init__(self, models: Models, config: Config) -> None:
        self._models = models
        self._config = config

    async def classify(self, question: str, history: tuple[Turn, ...] = ()) -> IntentLabel:
        messages: list[Any] = [SystemMessage(content=CLASSIFIER_PROMPT)]
        for turn in history[-RECENT_TURNS:]:
            asked, answered = replayed(turn)
            messages += [HumanMessage(content=asked), AIMessage(content=answered)]
        messages.append(HumanMessage(content=question))
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
