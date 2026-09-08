"""How much a model may think, and what happens when the endpoint says no.

Both halves were written after production caught them, and they are the same
mistake seen from two sides: a thinking setting is a demand, and an endpoint
that cannot meet it fails the whole turn.

The router asked for no reasoning and the endpoint mandated it — 400 on every
classification. Then the router became a model that cannot reason at all, kept
a positive setting, and asking for it filtered every provider away — 404 on
every classification. Both were invisible, because the classifier's fail-safe
swallows a failure and routes everything to the portfolio branch.
"""
from dataclasses import replace

import pytest

import app.intent as intent
import app.llm as llm
from app.config import Role
from app.intent import IntentLabel

NO_ENDPOINTS = (
    "Error code: 404 - {'error': {'message': 'No endpoints found that can handle "
    "the requested parameters.', 'code': 404, 'metadata': {'failed_routing_step': "
    "'Filter by Parameters'}}}"
)
MANDATORY = 'Reasoning is mandatory for this endpoint and cannot be disabled'


def role(model: str = "openai:m", effort: str = "low", sort: str = "throughput") -> Role:
    return Role(
        name="labelling",
        model=model,
        reasoning_effort=effort,
        answer_token_cap=200,
        provider_sort=sort,
    )


def body_for(effort: str = "low", model: str = "openai:m", sort: str = "throughput") -> dict:
    """What actually goes on the wire for a role shaped like this."""
    return llm._wire_options(role(model=model, effort=effort, sort=sort)).get("extra_body", {})


def on_wire(monkeypatch, base_url: str) -> None:
    """Point the module at an aggregator, or at a provider directly.

    Settings is a frozen dataclass on purpose — configuration does not change
    under a running service — so a test swaps the whole object rather than one
    field of it.
    """
    monkeypatch.setattr(llm, "settings", replace(llm.settings, model_base_url=base_url))


@pytest.fixture(autouse=True)
def on_the_aggregator(monkeypatch):
    """Thinking settings and provider policies only exist on the OpenAI wire.

    Talking to a provider directly there is nothing to choose between and no
    extra_body to put it in, so every test about either has to say which wire
    it is on.
    """
    on_wire(monkeypatch, "https://openrouter.ai/api/v1")


@pytest.fixture(autouse=True)
def clean_caches():
    llm._models_we_no_longer_ask_to_think.clear()
    llm.model_for.cache_clear()
    intent._labeler.cache_clear()
    yield
    llm._models_we_no_longer_ask_to_think.clear()


class TestThinkingSetting:
    def test_the_setting_is_sent_as_the_aggregator_expects(self):
        assert body_for(model="m")["reasoning"] == {"effort": "low"}

    def test_an_empty_setting_asks_for_nothing_at_all(self):
        # The only setting every model can honour: one that must think is not
        # told to stop, one that cannot think is not asked to start.
        assert "reasoning" not in body_for(effort="", model="m")

    def test_a_refused_model_is_never_asked_again(self):
        llm.stop_asking_it_to_think(role(model="stubborn"))
        assert "reasoning" not in body_for(model="stubborn")
        assert "reasoning" in body_for(model="other")

    def test_giving_up_twice_reports_that_we_already_had(self):
        assert llm.stop_asking_it_to_think(role()) is True
        assert llm.stop_asking_it_to_think(role()) is False, "the second failure is the caller's"

    def test_a_role_that_sends_no_setting_has_nothing_to_give_up(self):
        # Otherwise a 404 about some other parameter would be "cured" by
        # dropping a setting that was never in the request.
        assert llm.stop_asking_it_to_think(role(effort="")) is False
        assert "m" not in llm._models_we_no_longer_ask_to_think

    def test_both_refusals_are_recognised_by_what_they_say(self):
        assert llm.is_thinking_setting_rejected(Exception(MANDATORY)) is True
        assert llm.is_thinking_setting_rejected(Exception(NO_ENDPOINTS)) is True
        assert llm.is_thinking_setting_rejected(Exception("429 rate limited")) is False


class Labeler:
    """A structured-output runnable that refuses the setting the first time."""

    def __init__(self, refusals=1, saying=MANDATORY):
        self.refusals = refusals
        self.saying = saying
        self.attempts = 0

    async def ainvoke(self, _messages):
        self.attempts += 1
        if self.refusals > 0:
            self.refusals -= 1
            raise Exception(self.saying)
        return IntentLabel(intent="general", reason="stubbed")


def cached(labeler):
    """A stand-in for the cached factory, cache_clear and all.

    The retry clears the cache before rebuilding, so a double that cannot be
    cleared is a double that does not honour the contract under test.
    """
    factory = lambda: labeler  # noqa: E731 — one expression, named by assignment
    factory.cache_clear = lambda: None
    return factory


@pytest.fixture
def asking_for_thought(monkeypatch):
    """A labelling role that does send a setting — the only kind that retries."""
    monkeypatch.setattr(llm, "labelling", lambda: role(model="openai:router"))
    monkeypatch.setattr(intent, "labelling", lambda: role(model="openai:router"))


@pytest.fixture
def no_understudy(monkeypatch):
    """Take the answering model away, so a refusal has nowhere left to go.

    classify() falls back to the answering model when the labelling one cannot
    be reached (see app/intent.py). These tests are about what the retry does,
    not about that fallback, so they need the fallback to be unavailable —
    which is what a deployment where both roles run one model looks like.
    """
    monkeypatch.setattr(intent, "answering", lambda: role(model="openai:router"))


class TestClassifierRecovery:
    @pytest.mark.parametrize("refusal", [MANDATORY, NO_ENDPOINTS], ids=["mandatory", "filtered"])
    async def test_a_refused_setting_still_produces_a_label(
        self, monkeypatch, asking_for_thought, refusal
    ):
        labeler = Labeler(refusals=1, saying=refusal)
        monkeypatch.setattr(intent, "_labeler", cached(labeler))
        label = await intent.classify("what is a health factor?")
        assert label.intent == "general"
        assert labeler.attempts == 2, "one retry, not a loop"
        assert "openai:router" in llm._models_we_no_longer_ask_to_think

    async def test_a_second_refusal_is_raised_rather_than_retried_forever(
        self, monkeypatch, asking_for_thought, no_understudy
    ):
        labeler = Labeler(refusals=99)
        monkeypatch.setattr(intent, "_labeler", cached(labeler))
        with pytest.raises(Exception, match="Reasoning is mandatory"):
            await intent.classify("q")
        assert labeler.attempts == 2

    async def test_an_unrelated_failure_is_not_swallowed_by_the_retry(
        self, monkeypatch, asking_for_thought, no_understudy
    ):
        class Broken:
            attempts = 0

            async def ainvoke(self, _messages):
                Broken.attempts += 1
                raise RuntimeError("429 rate limited")

        monkeypatch.setattr(intent, "_labeler", cached(Broken()))
        with pytest.raises(RuntimeError, match="429"):
            await intent.classify("q")
        assert Broken.attempts == 1, "only a refused setting is worth a second try"

    async def test_a_role_that_asks_for_nothing_does_not_retry(self, monkeypatch, no_understudy):
        # The shipped labelling role. A 404 here is about something we are not
        # willing to give up, so it goes to the caller on the first failure.
        quiet = role(model="openai:instruct", effort="")
        monkeypatch.setattr(intent, "labelling", lambda: quiet)
        monkeypatch.setattr(intent, "answering", lambda: quiet)
        labeler = Labeler(refusals=99, saying=NO_ENDPOINTS)
        monkeypatch.setattr(intent, "_labeler", cached(labeler))
        with pytest.raises(Exception, match="No endpoints"):
            await intent.classify("q")
        assert labeler.attempts == 1


class TestProviderPolicy:
    """Which of an aggregator's providers may serve our prompts."""

    def test_nothing_is_sent_to_a_provider_we_talk_to_directly(self, monkeypatch):
        # extra_body is an OpenAI-client field; on the Anthropic client it is
        # not a parameter at all.
        on_wire(monkeypatch, "")
        assert llm._wire_options(role(model="anthropic:claude-haiku-4-5")) == {}

    def test_an_aggregator_gets_the_whole_policy(self):
        body = body_for(model="openai:deepseek/deepseek-v4-flash")
        assert body["provider"]["data_collection"] == "deny", "our prompts carry wallet balances"
        assert body["provider"]["sort"] == "throughput"
        assert body["reasoning"] == {"effort": "low"}

    def test_we_do_not_demand_a_provider_advertise_every_parameter(self):
        # It reads like "make sure they can really run tools" and is not that:
        # it covers every parameter in the request, and forcing a single tool
        # call makes the client add parallel_tool_calls, which none of the
        # answering model's fifteen providers advertises. On, this policy could
        # not be served by anybody, for any model, on any classification.
        assert "require_parameters" not in body_for()["provider"]

    def test_dropping_a_thinking_setting_leaves_the_rest_of_the_policy_standing(self):
        body = body_for()
        assert "reasoning" in body and body["provider"]["data_collection"] == "deny"
        llm.stop_asking_it_to_think(role(model="openai:m"))
        body = body_for()
        assert "reasoning" not in body and body["provider"]["data_collection"] == "deny"

    def test_each_role_asks_for_the_provider_its_own_job_wants(self):
        # A label is ten tokens and an answer is paragraphs, so "the best
        # provider" is a different provider for each. One shared sort made one
        # of them wrong by construction.
        assert body_for(sort="latency")["provider"]["sort"] == "latency"
        assert body_for(sort="throughput")["provider"]["sort"] == "throughput"
