"""The thinking budget, and what happens when an endpoint refuses one.

Written after production caught it: the router asked for no reasoning, the
endpoint mandates it, and every classification failed with a 400 for as long
as the setting stood — invisibly, because the classifier's fail-safe swallowed
it and routed everything to the portfolio branch.
"""
import pytest

import app.intent as intent
import app.llm as llm
from app.intent import IntentLabel


@pytest.fixture(autouse=True)
def clean_caches():
    llm._refuses_budget.clear()
    llm.get_model.cache_clear()
    llm.get_router_model.cache_clear()
    intent._labeler.cache_clear()
    yield
    llm._refuses_budget.clear()


class TestBudget:
    def test_a_budget_is_sent_as_the_aggregator_expects(self):
        assert llm._reasoning("low", "m") == {"extra_body": {"reasoning": {"effort": "low"}}}

    def test_an_empty_setting_leaves_the_model_alone(self):
        assert llm._reasoning("", "m") == {}

    def test_a_refusing_endpoint_is_never_asked_again(self):
        llm.drop_budget("stubborn")
        assert llm._reasoning("low", "stubborn") == {}
        assert llm._reasoning("low", "other") != {}

    def test_dropping_twice_reports_that_it_was_already_dropped(self):
        assert llm.drop_budget("m") is True
        assert llm.drop_budget("m") is False, "the second failure belongs to the caller"

    def test_the_refusal_is_recognised_by_what_it_says(self):
        mandatory = Exception('400 — "Reasoning is mandatory for this endpoint '
                              'and cannot be disabled"')
        assert llm.budget_was_refused(mandatory) is True
        assert llm.budget_was_refused(Exception("429 rate limited")) is False


class Labeler:
    """A structured-output runnable that refuses a budget the first time."""

    def __init__(self, refusals=1):
        self.refusals = refusals
        self.attempts = 0

    async def ainvoke(self, _messages):
        self.attempts += 1
        if self.refusals > 0:
            self.refusals -= 1
            raise Exception("Reasoning is mandatory for this endpoint and cannot be disabled")
        return IntentLabel(intent="general", reason="stubbed")


def cached(labeler):
    """A stand-in for the cached factory, cache_clear and all.

    The retry clears the cache before rebuilding, so a double that cannot be
    cleared is a double that does not honour the contract under test.
    """
    factory = lambda: labeler  # noqa: E731 — one expression, named by assignment
    factory.cache_clear = lambda: None
    return factory


class TestClassifierRecovery:
    async def test_a_refused_budget_is_dropped_and_the_turn_still_gets_a_label(self, monkeypatch):
        labeler = Labeler(refusals=1)
        monkeypatch.setattr(intent, "_labeler", cached(labeler))
        label = await intent.classify("what is a health factor?")
        assert label.intent == "general"
        assert labeler.attempts == 2, "one retry, not a loop"
        assert llm.labelling_model() in llm._refuses_budget

    async def test_a_second_refusal_is_raised_rather_than_retried_forever(self, monkeypatch):
        labeler = Labeler(refusals=99)
        monkeypatch.setattr(intent, "_labeler", cached(labeler))
        with pytest.raises(Exception, match="Reasoning is mandatory"):
            await intent.classify("q")
        assert labeler.attempts == 2

    async def test_an_unrelated_failure_is_not_swallowed_by_the_retry(self, monkeypatch):
        class Broken:
            attempts = 0

            async def ainvoke(self, _messages):
                Broken.attempts += 1
                raise RuntimeError("429 rate limited")

        monkeypatch.setattr(intent, "_labeler", cached(Broken()))
        with pytest.raises(RuntimeError, match="429"):
            await intent.classify("q")
        assert Broken.attempts == 1, "only a refused budget is worth a second try"
