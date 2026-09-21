import pytest

from app.adapters.memory import StaticPanel
from app.agent.intent import IntentClassifier, IntentLabel
from app.agent.llm import Models, is_thinking_setting_rejected
from app.config import Config, Role
from app.settings import Settings

NO_ENDPOINTS = (
    "Error code: 404 - {'error': {'message': 'No endpoints found that can handle "
    "the requested parameters.', 'code': 404, 'metadata': {'failed_routing_step': "
    "'Filter by Parameters'}}}"
)
MANDATORY = "Reasoning is mandatory for this endpoint and cannot be disabled"
AGGREGATOR = "https://openrouter.ai/api/v1"


def role(model: str = "openai:m", effort: str = "low", sort: str = "throughput") -> Role:
    return Role(
        name="labelling",
        model=model,
        reasoning_effort=effort,
        answer_token_cap=200,
        provider_sort=sort,
    )


class Labeler:
    def __init__(self, refusals=1, saying=MANDATORY, label="general"):
        self.refusals = refusals
        self.saying = saying
        self.label = label
        self.attempts = 0

    def with_structured_output(self, _schema, **_kwargs):
        return self

    async def ainvoke(self, _messages):
        self.attempts += 1
        if self.refusals > 0:
            self.refusals -= 1
            raise Exception(self.saying)
        return IntentLabel(
            intent=self.label, reason="stubbed", stance="asking", language="English", risk="unknown"
        )


def models(client=None, **env) -> Models:
    settings = Settings(**{"model_base_url": AGGREGATOR, **env})
    return Models(settings, factory=lambda _name, **_kwargs: client)


def body_for(effort: str = "low", model: str = "openai:m", sort: str = "throughput") -> dict:
    return models().wire_options(role(model=model, effort=effort, sort=sort)).get("extra_body", {})


class TestThinkingSetting:
    def test_the_setting_is_sent_as_the_aggregator_expects(self):
        assert body_for(model="m")["reasoning"] == {"effort": "low"}

    def test_an_empty_setting_asks_for_nothing_at_all(self):
        assert "reasoning" not in body_for(effort="", model="m")

    def test_a_refused_model_is_never_asked_again(self):
        ours = models()
        ours.stop_asking_it_to_think(role(model="stubborn"))
        assert "reasoning" not in ours.wire_options(role(model="stubborn"))["extra_body"]
        assert "reasoning" in ours.wire_options(role(model="other"))["extra_body"]

    def test_giving_up_twice_reports_that_we_already_had(self):
        ours = models()
        assert ours.stop_asking_it_to_think(role()) is True
        assert ours.stop_asking_it_to_think(role()) is False, "the second failure is the caller's"

    def test_a_role_that_sends_no_setting_has_nothing_to_give_up(self):
        ours = models()
        assert ours.stop_asking_it_to_think(role(effort="")) is False
        assert "m" not in ours.no_longer_asked_to_think

    def test_both_refusals_are_recognised_by_what_they_say(self):
        assert is_thinking_setting_rejected(Exception(MANDATORY)) is True
        assert is_thinking_setting_rejected(Exception(NO_ENDPOINTS)) is True
        assert is_thinking_setting_rejected(Exception("429 rate limited")) is False

    def test_giving_up_forgets_the_client_built_with_the_setting(self):
        built = []
        ours = Models(
            Settings(model_base_url=AGGREGATOR),
            factory=lambda name, **kwargs: built.append(kwargs) or Labeler(),
        )
        asking = role(model="openai:m")
        ours.for_role(asking)
        ours.stop_asking_it_to_think(asking)
        ours.for_role(asking)
        assert len(built) == 2, "a fresh client, without the setting"
        assert "reasoning" not in built[1]["extra_body"]


def classifier(client, **env) -> IntentClassifier:
    ours = models(client, router_model="openai:router", router_reasoning_effort="low", **env)
    return IntentClassifier(ours, Config(ours._settings, StaticPanel()))


class TestClassifierRecovery:
    @pytest.mark.parametrize("refusal", [MANDATORY, NO_ENDPOINTS], ids=["mandatory", "filtered"])
    async def test_a_refused_setting_still_produces_a_label(self, refusal):
        labeler = Labeler(refusals=1, saying=refusal)
        label = await classifier(labeler).classify("what is a health factor?")
        assert label.intent == "general"
        assert labeler.attempts == 2, "one retry, not a loop"

    async def test_the_model_is_remembered_as_one_that_will_not_think(self):
        labeler = Labeler(refusals=1)
        ours = models(labeler, router_model="openai:router", router_reasoning_effort="low")
        await IntentClassifier(ours, Config(ours._settings, StaticPanel())).classify("q")
        assert "openai:router" in ours.no_longer_asked_to_think

    async def test_a_second_refusal_is_raised_rather_than_retried_forever(self):
        labeler = Labeler(refusals=99)
        with pytest.raises(Exception, match="Reasoning is mandatory"):
            await classifier(labeler, model="openai:router", reasoning_effort="low").classify("q")
        assert labeler.attempts == 2

    async def test_an_unrelated_failure_is_not_swallowed_by_the_retry(self):
        class Broken:
            attempts = 0

            def with_structured_output(self, _schema, **_kwargs):
                return self

            async def ainvoke(self, _messages):
                Broken.attempts += 1
                raise RuntimeError("429 rate limited")

        with pytest.raises(RuntimeError, match="429"):
            await classifier(Broken(), model="openai:router", reasoning_effort="low").classify("q")
        assert Broken.attempts == 1, "only a refused setting is worth a second try"

    async def test_a_role_that_asks_for_nothing_does_not_retry(self):
        labeler = Labeler(refusals=99, saying=NO_ENDPOINTS)
        quiet = models(labeler, model="openai:instruct", reasoning_effort="")
        with pytest.raises(Exception, match="No endpoints"):
            await IntentClassifier(quiet, Config(quiet._settings, StaticPanel())).classify("q")
        assert labeler.attempts == 1


class TestProviderPolicy:
    def test_nothing_is_sent_to_a_provider_we_talk_to_directly(self):
        direct = models(model_base_url="")
        assert direct.wire_options(role(model="anthropic:claude-haiku-4-5")) == {}

    def test_an_aggregator_gets_the_whole_policy(self):
        body = body_for(model="openai:deepseek/deepseek-v4-flash")
        assert body["provider"]["data_collection"] == "deny", "our prompts carry wallet balances"
        assert body["provider"]["sort"] == "throughput"
        assert body["reasoning"] == {"effort": "low"}

    def test_we_do_not_demand_a_provider_advertise_every_parameter(self):
        assert "require_parameters" not in body_for()["provider"]

    def test_dropping_a_thinking_setting_leaves_the_rest_of_the_policy_standing(self):
        ours = models()
        body = ours.wire_options(role())["extra_body"]
        assert "reasoning" in body and body["provider"]["data_collection"] == "deny"
        ours.stop_asking_it_to_think(role())
        body = ours.wire_options(role())["extra_body"]
        assert "reasoning" not in body and body["provider"]["data_collection"] == "deny"

    def test_each_role_asks_for_the_provider_its_own_job_wants(self):
        assert body_for(sort="latency")["provider"]["sort"] == "latency"
        assert body_for(sort="throughput")["provider"]["sort"] == "throughput"
