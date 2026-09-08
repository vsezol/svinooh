"""One job, one model, one set of dials — and where those dials come from.

A role exists so the choices can move apart: the model that answers is read by
a person and can afford to think, the model that labels picks one word out of
two in front of every answer.

Resolution is the product's own order, admin panel then environment then the
shipped default, so these tests pin all three layers and which one wins.
"""
import pytest

from app import remote_config
from app.config import _role, answering, labelling, tool_hops


@pytest.fixture(autouse=True)
def no_panel(monkeypatch):
    """Nothing decided in the panel unless a test says so."""
    monkeypatch.setattr(remote_config, "_values", {})
    monkeypatch.setattr(remote_config, "_fetched_at", 0.0)


@pytest.fixture
def env(monkeypatch):
    """A clean environment: no AGENT_* variable leaks in from the shell."""
    for key in list(__import__("os").environ):
        if key.startswith("AGENT_"):
            monkeypatch.delenv(key, raising=False)
    return monkeypatch


class TestReadingARole:
    def test_a_role_without_a_model_of_its_own_uses_the_answering_one(self, env):
        env.setenv("AGENT_MODEL", "openai:answers")
        critic = _role("critic", "CRITIC_", {}, panel_keys=("criticModel", "criticEffort", "criticMaxTokens", "criticSort"))
        assert critic.model == "openai:answers", "a new role runs before it is configured"

    def test_a_role_can_be_pointed_at_its_own_model(self, env):
        env.setenv("AGENT_MODEL", "openai:answers")
        env.setenv("AGENT_CRITIC_MODEL", "openai:critic")
        critic = _role("critic", "CRITIC_", {}, panel_keys=("criticModel", "criticEffort", "criticMaxTokens", "criticSort"))
        assert critic.model == "openai:critic"

    def test_each_role_carries_its_own_thinking_and_writing_limits(self, env):
        env.setenv("AGENT_CRITIC_REASONING_EFFORT", "high")
        env.setenv("AGENT_CRITIC_MAX_TOKENS", "4096")
        critic = _role("critic", "CRITIC_", {}, panel_keys=("criticModel", "criticEffort", "criticMaxTokens", "criticSort"), effort="low", answer_token_cap=200)
        assert critic.reasoning_effort == "high" and critic.answer_token_cap == 4096

    def test_defaults_belong_to_the_role_not_to_the_service(self, env):
        keys = ("m", "e", "t", "s")
        cheap = _role("labels", "ROUTER_", {}, panel_keys=keys, effort="low", answer_token_cap=200)
        thorough = _role("critic", "CRITIC_", {}, panel_keys=keys, effort="high", answer_token_cap=4096)
        assert (cheap.reasoning_effort, cheap.answer_token_cap) == ("low", 200)
        assert (thorough.reasoning_effort, thorough.answer_token_cap) == ("high", 4096)

    def test_the_older_unprefixed_effort_variable_still_configures_answering(self, env):
        # AGENT_REASONING_EFFORT named the only role there was; deployments
        # that set it must keep working.
        env.setenv("AGENT_REASONING_EFFORT", "medium")
        role = _role("answering", "", {}, panel_keys=("model", "reasoningEffort", "maxTokens", "providerSort"), effort="minimal")
        assert role.reasoning_effort == "medium"

    def test_a_role_is_frozen(self):
        with pytest.raises(Exception):
            answering().model = "openai:something-else"


class TestTheRolesWeHave:
    def test_answering_thinks_a_little_and_may_write_an_answer(self):
        assert answering().name == "answering" and answering().answer_token_cap >= 1024

    def test_labelling_writes_almost_nothing(self):
        assert labelling().name == "labelling"
        assert labelling().answer_token_cap <= 256, "a label is a word, not a paragraph"

    def test_each_role_carries_a_provider_preference_of_its_own(self):
        # They agree today. That is a measurement rather than a coincidence:
        # sorting the labelling model by latency is the obvious idea once
        # streaming shows its call is the whole wait before the first word,
        # and it was tried on production and did not help. The dial is per
        # role so the next attempt is a dropdown rather than a deploy.
        assert labelling().provider_sort == "throughput"
        assert answering().provider_sort == "throughput"

    def test_labelling_asks_for_no_thinking_at_all(self):
        # Both production outages were a thinking setting an endpoint would not
        # take: "none" drew a 400 from a model that must think, and a positive
        # value drew a 404 from one that cannot. The empty setting sends
        # nothing, and nothing is what neither can refuse.
        assert labelling().reasoning_effort == ""

    def test_the_panel_writes_that_empty_setting_as_a_word(self, env, monkeypatch):
        # A select cannot offer "nothing", and a blank row would be read as
        # unset and fall through to the environment — so the panel says
        # "default" and it means the same as sending no instruction.
        env.setenv("AGENT_ROUTER_REASONING_EFFORT", "high")
        monkeypatch.setattr(remote_config, "_values", {"routerReasoningEffort": "default"})
        assert labelling().reasoning_effort == ""

    def test_one_role_thinking_is_not_another_role_thinking(self, env):
        # AGENT_REASONING_EFFORT is the answering role's variable. It used to
        # stand in for labelling's too, so turning one dial moved the other.
        env.setenv("AGENT_REASONING_EFFORT", "high")
        assert answering().reasoning_effort == "high"
        assert labelling().reasoning_effort == ""


class TestWhereTheDialsComeFrom:
    """Admin panel, then environment, then what the service shipped with."""

    def test_the_panel_wins_over_the_environment(self, env, monkeypatch):
        env.setenv("AGENT_MODEL", "openai:from-env")
        monkeypatch.setattr(remote_config, "_values", {"model": "openai:from-panel"})
        assert answering().model == "openai:from-panel"

    def test_the_environment_answers_when_the_panel_has_not(self, env):
        env.setenv("AGENT_MODEL", "openai:from-env")
        assert answering().model == "openai:from-env"

    def test_the_default_answers_when_neither_has(self, env):
        assert answering().model == "anthropic:claude-haiku-4-5"

    def test_an_empty_panel_value_is_not_a_decision(self, env, monkeypatch):
        # Clearing a field means "no opinion", not "set it to nothing".
        env.setenv("AGENT_MODEL", "openai:from-env")
        monkeypatch.setattr(remote_config, "_values", {"model": ""})
        assert answering().model == "openai:from-env"

    def test_a_labelling_model_left_blank_falls_back_to_answering(self, env, monkeypatch):
        monkeypatch.setattr(remote_config, "_values",
                            {"model": "openai:answers", "routerModel": ""})
        assert labelling().model == "openai:answers"

    def test_numbers_come_through_the_same_way(self, env, monkeypatch):
        env.setenv("AGENT_TOOL_HOPS", "5")
        assert tool_hops() == 5
        monkeypatch.setattr(remote_config, "_values", {"toolHops": 2})
        assert tool_hops() == 2

    def test_a_nonsense_panel_number_does_not_take_effect(self, env, monkeypatch):
        env.setenv("AGENT_TOOL_HOPS", "5")
        monkeypatch.setattr(remote_config, "_values", {"toolHops": "three"})
        assert tool_hops() == 5
