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

import app.agent.intent as intent
from app.config import Role
from app.agent.intent import IntentLabel


def role(model: str) -> Role:
    return Role(name="r", model=model, reasoning_effort="", answer_token_cap=200)


CHEAP = role("openai:cheap-labeller")
GOOD = role("openai:the-one-that-answers")


class Stub:
    """A structured-output runnable that either labels or refuses, and counts."""

    def __init__(self, label: str | None = "general", refusing: str | None = None):
        self.label = label
        self.refusing = refusing
        self.calls = 0

    async def ainvoke(self, _messages):
        self.calls += 1
        if self.refusing:
            raise RuntimeError(self.refusing)
        return IntentLabel(intent=self.label, reason="stubbed")


def cached(stub):
    factory = lambda: stub  # noqa: E731 — one expression, named by assignment
    factory.cache_clear = lambda: None
    return factory


@pytest.fixture
def two_models(monkeypatch):
    """The shape this is about: a cheap labeller and a separate answering model."""
    monkeypatch.setattr(intent, "labelling", lambda: CHEAP)
    monkeypatch.setattr(intent, "answering", lambda: GOOD)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    intent._labeler.cache_clear()
    intent._understudy.cache_clear()


class TestWhenTheCheapModelWorks:
    async def test_the_answering_model_is_not_troubled(self, monkeypatch, two_models):
        cheap, good = Stub(label="portfolio"), Stub()
        monkeypatch.setattr(intent, "_labeler", cached(cheap))
        monkeypatch.setattr(intent, "_understudy", cached(good))
        label = await intent.classify("how much do I have?")
        assert label.intent == "portfolio"
        assert (cheap.calls, good.calls) == (1, 0), "the cheap one is the point"


class TestWhenTheCheapModelCannotBeReached:
    async def test_the_question_is_still_labelled(self, monkeypatch, two_models):
        cheap = Stub(refusing="404 No endpoints found that can handle the requested parameters")
        good = Stub(label="general")
        monkeypatch.setattr(intent, "_labeler", cached(cheap))
        monkeypatch.setattr(intent, "_understudy", cached(good))
        label = await intent.classify("what is impermanent loss?")
        assert label.intent == "general", "the label is right, which is the whole point"
        assert good.calls == 1

    async def test_it_says_so_where_somebody_will_see_it(self, monkeypatch, two_models, caplog):
        monkeypatch.setattr(intent, "_labeler", cached(Stub(refusing="404 no endpoints")))
        monkeypatch.setattr(intent, "_understudy", cached(Stub()))
        with caplog.at_level(logging.WARNING, logger="svinooh-ai"):
            await intent.classify("q")
        assert CHEAP.model in caplog.text and GOOD.model in caplog.text

    async def test_both_failing_is_the_caller_problem(self, monkeypatch, two_models):
        monkeypatch.setattr(intent, "_labeler", cached(Stub(refusing="404 no endpoints")))
        monkeypatch.setattr(intent, "_understudy", cached(Stub(refusing="500 upstream")))
        with pytest.raises(RuntimeError, match="500 upstream"):
            await intent.classify("q")


class TestWhenOneModelDoesBothJobs:
    async def test_there_is_nothing_to_fall_back_to(self, monkeypatch):
        # The shipped default: no labelling model of its own. Trying the same
        # model a second time would only pay twice for the same failure.
        monkeypatch.setattr(intent, "labelling", lambda: GOOD)
        monkeypatch.setattr(intent, "answering", lambda: GOOD)
        only = Stub(refusing="429 rate limited")
        understudy = Stub()
        monkeypatch.setattr(intent, "_labeler", cached(only))
        monkeypatch.setattr(intent, "_understudy", cached(understudy))
        with pytest.raises(RuntimeError, match="429"):
            await intent.classify("q")
        assert understudy.calls == 0
