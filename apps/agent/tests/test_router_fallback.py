"""What happens to routing when the labelling model cannot be reached.

Twice in production the classifier failed on every single request and nothing
looked wrong. The fallback for "no label" was a label — route to the portfolio
branch — so every general question was answered as if it had been about the
user's money: slower, and framed wrongly enough to invent a product feature.

A wrong turn taken confidently on every question is worse than a slow one. So
the answering model, which is demonstrably reachable, does the labelling
instead, and the failure is loud rather than silent.
"""

import logging

import pytest

from app.adapters.memory import StaticPanel
from app.agent.intent import IntentClassifier, IntentLabel
from app.agent.llm import Models
from app.config import Config
from app.settings import Settings

CHEAP = "openai:cheap-labeller"
GOOD = "openai:the-one-that-answers"


class Stub:
    """A client that either labels or refuses, and counts."""

    def __init__(self, label: str | None = "general", refusing: str | None = None):
        self.label = label
        self.refusing = refusing
        self.calls = 0

    def with_structured_output(self, _schema, **_kwargs):
        return self

    async def ainvoke(self, _messages):
        self.calls += 1
        if self.refusing:
            raise RuntimeError(self.refusing)
        return IntentLabel(intent=self.label, reason="stubbed")


def classifier(*, answering: Stub, labelling: Stub | None = None) -> IntentClassifier:
    """The shape this is about: a cheap labeller and a separate answering model.

    Without a labelling stub, the answering model does both jobs — the
    shipped default.
    """
    clients = {GOOD: answering, CHEAP: labelling}
    settings = Settings(model=GOOD, router_model=CHEAP if labelling else "")
    models = Models(settings, factory=lambda name, **_kwargs: clients[name])
    return IntentClassifier(models, Config(settings, StaticPanel()))


class TestWhenTheCheapModelWorks:
    async def test_the_answering_model_is_not_troubled(self):
        cheap, good = Stub(label="portfolio"), Stub()
        label = await classifier(answering=good, labelling=cheap).classify("how much do I have?")
        assert label.intent == "portfolio"
        assert (cheap.calls, good.calls) == (1, 0), "the cheap one is the point"


class TestWhenTheCheapModelCannotBeReached:
    async def test_the_question_is_still_labelled(self):
        cheap = Stub(refusing="404 No endpoints found that can handle the requested parameters")
        good = Stub(label="general")
        label = await classifier(answering=good, labelling=cheap).classify(
            "what is impermanent loss?"
        )
        assert label.intent == "general", "the label is right, which is the whole point"
        assert good.calls == 1

    async def test_it_says_so_where_somebody_will_see_it(self, caplog):
        ours = classifier(answering=Stub(), labelling=Stub(refusing="404 no endpoints"))
        with caplog.at_level(logging.WARNING, logger="svinooh-ai"):
            await ours.classify("q")
        assert CHEAP in caplog.text and GOOD in caplog.text

    async def test_both_failing_is_the_caller_problem(self):
        ours = classifier(
            answering=Stub(refusing="500 upstream"), labelling=Stub(refusing="404 no endpoints")
        )
        with pytest.raises(RuntimeError, match="500 upstream"):
            await ours.classify("q")


class TestWhenOneModelDoesBothJobs:
    async def test_there_is_nothing_to_fall_back_to(self):
        # The shipped default: no labelling model of its own. Trying the same
        # model a second time would only pay twice for the same failure.
        only = Stub(refusing="429 rate limited")
        with pytest.raises(RuntimeError, match="429"):
            await classifier(answering=only).classify("q")
        assert only.calls == 1
