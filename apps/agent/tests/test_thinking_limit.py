"""How much a model may think, and what happens when it insists on more.

Written after production caught it: the router asked for no reasoning, the
endpoint mandates it, and every classification failed with a 400 for as long
as the setting stood — invisibly, because the classifier's fail-safe swallowed
it and routed everything to the portfolio branch.
"""
from dataclasses import replace

import pytest

import app.intent as intent
import app.llm as llm
from app.intent import IntentLabel


def on_wire(monkeypatch, base_url: str) -> None:
    """Point the module at an aggregator, or at a provider directly.

    Settings is a frozen dataclass on purpose — configuration does not change
    under a running service — so a test swaps the whole object rather than one
    field of it.
    """
    monkeypatch.setattr(llm, "settings", replace(llm.settings, model_base_url=base_url))


@pytest.fixture(autouse=True)
def on_the_aggregator(monkeypatch):
    """Budgets and provider policies only exist on the OpenAI wire.

    Talking to a provider directly there is nothing to choose between and no
    extra_body to put it in, so every test about either has to say which wire
    it is on.
    """
    on_wire(monkeypatch, "https://openrouter.ai/api/v1")


@pytest.fixture(autouse=True)
def clean_caches():
    llm._models_that_insist_on_thinking.clear()
    llm.get_model.cache_clear()
    llm.get_router_model.cache_clear()
    intent._labeler.cache_clear()
    yield
    llm._models_that_insist_on_thinking.clear()


class TestThinkingLimit:
    def test_the_limit_is_sent_as_the_aggregator_expects(self):
        body = llm._reasoning("low", "m")["extra_body"]
        assert body["reasoning"] == {"effort": "low"}

    def test_an_empty_setting_asks_for_no_budget(self):
        assert "reasoning" not in llm._reasoning("", "m").get("extra_body", {})

    def test_a_model_that_insists_is_never_asked_to_think_less_again(self):
        llm.let_it_think("stubborn")
        assert "reasoning" not in llm._reasoning("low", "stubborn")["extra_body"]
        assert "reasoning" in llm._reasoning("low", "other")["extra_body"]

    def test_giving_up_twice_reports_that_we_already_had(self):
        assert llm.let_it_think("m") is True
        assert llm.let_it_think("m") is False, "the second failure belongs to the caller"

    def test_the_refusal_is_recognised_by_what_it_says(self):
        mandatory = Exception('400 — "Reasoning is mandatory for this endpoint '
                              'and cannot be disabled"')
        assert llm.is_thinking_mandatory_error(mandatory) is True
        assert llm.is_thinking_mandatory_error(Exception("429 rate limited")) is False


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
    async def test_a_model_that_insists_still_produces_a_label(self, monkeypatch):
        labeler = Labeler(refusals=1)
        monkeypatch.setattr(intent, "_labeler", cached(labeler))
        label = await intent.classify("what is a health factor?")
        assert label.intent == "general"
        assert labeler.attempts == 2, "one retry, not a loop"
        assert llm.labelling_model() in llm._models_that_insist_on_thinking

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


class TestProviderPolicy:
    """Which of an aggregator's providers may serve our prompts."""

    def test_nothing_is_sent_to_a_provider_we_talk_to_directly(self, monkeypatch):
        # extra_body is an OpenAI-client field; on the Anthropic client it is
        # not a parameter at all.
        on_wire(monkeypatch, "")
        assert llm._reasoning("low", "anthropic:claude-haiku-4-5") == {}

    def test_an_aggregator_gets_the_whole_policy(self):
        body = llm._reasoning("low", "openai:deepseek/deepseek-v4-flash")["extra_body"]
        assert body["provider"]["data_collection"] == "deny", "our prompts carry wallet balances"
        assert body["provider"]["require_parameters"] is True, "tools are not optional here"
        assert body["provider"]["sort"] == "throughput"
        assert body["reasoning"] == {"effort": "low"}

    def test_letting_a_model_think_leaves_the_provider_policy_standing(self):
        llm.let_it_think("openai:m")
        body = llm._reasoning("low", "openai:m")["extra_body"]
        assert "reasoning" not in body and body["provider"]["sort"] == "throughput"
