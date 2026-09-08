"""One job, one model, one set of dials.

A role exists so the choices can move apart: the model that answers is read by
a person and can afford to think, the model that labels picks one word out of
two in front of every answer. These tests pin the reading of a role from the
environment, including what a role does before anyone has configured it.
"""
import pytest

from app.config import ANSWERING, LABELLING, _role


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
        critic = _role("critic", "CRITIC_")
        assert critic.model == "openai:answers", "a new role runs before it is configured"

    def test_a_role_can_be_pointed_at_its_own_model(self, env):
        env.setenv("AGENT_MODEL", "openai:answers")
        env.setenv("AGENT_CRITIC_MODEL", "openai:critic")
        assert _role("critic", "CRITIC_").model == "openai:critic"

    def test_each_role_carries_its_own_thinking_and_writing_limits(self, env):
        env.setenv("AGENT_CRITIC_REASONING_EFFORT", "high")
        env.setenv("AGENT_CRITIC_MAX_TOKENS", "4096")
        critic = _role("critic", "CRITIC_", effort="low", max_tokens=200)
        assert critic.reasoning_effort == "high" and critic.max_tokens == 4096

    def test_defaults_belong_to_the_role_not_to_the_service(self, env):
        cheap = _role("labels", "ROUTER_", effort="low", max_tokens=200)
        thorough = _role("critic", "CRITIC_", effort="high", max_tokens=4096)
        assert (cheap.reasoning_effort, cheap.max_tokens) == ("low", 200)
        assert (thorough.reasoning_effort, thorough.max_tokens) == ("high", 4096)

    def test_the_older_unprefixed_effort_variable_still_configures_answering(self, env):
        # AGENT_REASONING_EFFORT named the only role there was; deployments
        # that set it must keep working.
        env.setenv("AGENT_REASONING_EFFORT", "medium")
        assert _role("answering", "", effort="minimal").reasoning_effort == "medium"

    def test_a_role_is_frozen(self):
        with pytest.raises(Exception):
            ANSWERING.model = "openai:something-else"


class TestTheRolesWeHave:
    def test_answering_thinks_a_little_and_may_write_an_answer(self):
        assert ANSWERING.name == "answering" and ANSWERING.max_tokens >= 1024

    def test_labelling_writes_almost_nothing(self):
        assert LABELLING.name == "labelling"
        assert LABELLING.max_tokens <= 256, "a label is a word, not a paragraph"

    def test_labelling_never_asks_for_no_thinking_at_all(self):
        # Some endpoints refuse to think less than they want to; "none" is the
        # value that produced a 400 on every classification in production.
        assert LABELLING.reasoning_effort != "none"
