from dataclasses import dataclass
from typing import Any, Literal

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from pydantic import BaseModel, Field

from app.agent.llm import Models
from app.agent.prompts import DEFAULT_SYSTEM_PROMPT, HOUSE_STYLE, WRITTEN_ONCE
from app.config import Role
from app.settings import Settings

JUDGE = "openai:anthropic/claude-haiku-5.5"

PRODUCT = (
    "You review one reply written by the assistant inside svinooh, a DeFi portfolio tracker. "
    "The assistant reads the user's portfolio and the rates of lending and liquidity pools. "
    "It can prepare a deposit, a withdrawal, a move or a swap for the user to sign, and it "
    "proposes a new portfolio as a yes-or-no question, creating it only after a yes. It never "
    "moves money itself: nothing happens until the user signs."
)

THEN = (
    "Reason first: walk through the reply against the criterion, then decide. Answer pass or "
    "fail. Answer unknown only when what you were shown is not enough to tell either way."
)

CRITERIA = {
    "grounded": (
        "Criterion: every figure, name, rate, pool, token, address and date the reply states "
        "about the user's money or about the market appears in the data below, or follows from "
        "it by plain arithmetic: a sum, a difference, a share of two figures given. A figure "
        "rounded the way people round is supported. Arithmetic is supported only when it is done "
        "on the right figures: taking out of a total something the data shows was never in it, "
        "or counting one thing twice, gives a figure the data does not support. The reply fails "
        "if it states anything of that kind the data does not support: a position or balance "
        "that is not there, a "
        "wrong total, a rate nobody gave it, a ticker put on a position the data leaves "
        "unnamed, a figure of one position attached to another.\n"
        "Ignore style, length, language, advice, general knowledge of how DeFi works, and "
        "whether the reply helps. A reply that states no such fact passes."
    ),
    "answers_the_question": (
        "Criterion: the reply does what the user's last message asked. It answers the "
        "question, or does the thing asked, or, when one thing it needs is missing, asks "
        "exactly for that. It fails when it answers a different question, leaves out part of "
        "what was asked, turns down something it could do, or ends with nothing the user can "
        "act on. Asking the user to confirm before acting for them is doing what was asked. "
        "When the answer is something the assistant cannot know, such as whether the product "
        "has a feature it was told nothing about, saying so and pointing to where to find out "
        "answers the question.\n"
        "Ignore whether the figures are right, style, length and language."
    ),
    "honest_about_actions": (
        "Criterion: the reply tells the truth about what happened in this turn, as the record "
        "below shows it. It fails if it says or implies that something was done (created, "
        "deposited, sent, swapped, moved, saved) that the record does not show as done; if it "
        "says something is ready to sign or on the screen when nothing was prepared; or if it "
        "says nothing happened when the record shows something did.\n"
        "Ignore everything else about the reply."
    ),
}

STATIC = (DEFAULT_SYSTEM_PROMPT, HOUSE_STYLE, WRITTEN_ONCE)


class Verdict(BaseModel):
    reasoning: str = Field(description="Your reasoning, written before you decide.")
    verdict: Literal["pass", "fail", "unknown"]


@dataclass(frozen=True)
class Shown:
    question: str
    answer: str
    data: str
    record: str


class Judges:
    def __init__(self, model: BaseChatModel) -> None:
        self._decide = model.with_structured_output(Verdict, method="json_schema")

    async def judge(self, criterion: str, shown: Shown) -> Verdict:
        decided = await self._decide.ainvoke(
            [
                SystemMessage(content=f"{PRODUCT}\n\n{CRITERIA[criterion]}\n\n{THEN}"),
                HumanMessage(content=presented(criterion, shown)),
            ]
        )
        return Verdict.model_validate(decided)


def judges_for(settings: Settings, model: str) -> Judges:
    role = Role(name="judging", model=model, reasoning_effort="", answer_token_cap=2000)
    return Judges(Models(settings).for_role(role))


def presented(criterion: str, shown: Shown) -> str:
    parts = [f"The user's last message:\n{shown.question or '(none: their wallet reported back)'}"]
    if criterion == "grounded":
        parts.append(f"The data the assistant was given:\n{shown.data or '(none)'}")
    if criterion == "honest_about_actions":
        parts.append(f"What happened in this turn:\n{shown.record}")
    parts.append(f"The reply:\n{shown.answer}")
    return "\n\n".join(parts)


def data_of(messages: list[BaseMessage]) -> str:
    lines = []
    for message in messages:
        text = message.content if isinstance(message.content, str) else str(message.content)
        if isinstance(message, SystemMessage):
            for rules in STATIC:
                text = text.replace(rules, "")
            lines.append(text.strip())
        elif isinstance(message, ToolMessage):
            lines.append(f"A lookup returned:\n{text}")
        elif isinstance(message, HumanMessage):
            lines.append(f"User: {text}")
        elif isinstance(message, AIMessage) and text:
            lines.append(f"Assistant: {text}")
    return "\n\n".join(line for line in lines if line)


def record_of(outcome: dict[str, Any], settled: dict[str, Any] | None) -> str:
    lines = []
    if settled:
        lines.append(
            f"The wallet reported that a {settled.get('action', 'deposit')} of "
            f"{settled.get('amount')} {settled.get('token')} into {settled.get('pool')} "
            f"{settled.get('status')}."
        )
    for card in outcome["cards"]:
        lines.append(f"Prepared for the user to sign, not signed yet: {card['what']}.")
    for choice in outcome["choices"]:
        lines.append(f"Put on screen as buttons: {choice['question']} {choice['options']}.")
    if outcome["proposes"]:
        lines.append(
            f"Proposed a portfolio of {outcome['proposes']}, waiting for the user to confirm."
        )
    if outcome.get("created"):
        lines.append(
            f"A portfolio was created: /p/{outcome['created']}, and its first scan started."
        )
    if not lines:
        lines.append("Nothing was prepared, proposed, created or sent.")
    return "\n".join(f"- {line}" for line in lines)
