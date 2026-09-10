"""One job, one model, one set of dials — and where those dials come from.

A role exists so the choices can move apart: the model that answers is read by
a person and can afford to think, the model that labels picks one word out of
two in front of every answer.

Resolution is the product's own order, admin panel then environment then the
shipped default, so these tests pin all three layers and which one wins. Each
builds its own Settings and its own panel; nothing here reads the shell.
"""

from dataclasses import FrozenInstanceError

import pytest

from app.adapters.memory import StaticPanel
from app.config import Config
from app.panel import NOTHING_DECIDED, PanelValues
from app.settings import Settings


def configured(panel: PanelValues = NOTHING_DECIDED, **env: object) -> Config:
    """The dials with this environment and this panel, and nothing else."""
    return Config(Settings(**env), StaticPanel(panel))


class TestTheRolesWeHave:
    def test_answering_thinks_a_little_and_may_write_an_answer(self):
        role = configured().answering()
        assert role.name == "answering" and role.answer_token_cap >= 1024
        assert role.reasoning_effort == "minimal"

    def test_labelling_writes_almost_nothing(self):
        role = configured().labelling()
        assert role.name == "labelling"
        assert role.answer_token_cap <= 256, "a label is a word, not a paragraph"

    def test_labelling_runs_on_the_answering_model_until_told_otherwise(self):
        assert configured(model="openai:answers").labelling().model == "openai:answers"

    def test_labelling_can_be_pointed_at_its_own_model(self):
        dials = configured(model="openai:answers", router_model="openai:cheap")
        assert dials.labelling().model == "openai:cheap"
        assert dials.answering().model == "openai:answers"

    def test_each_role_carries_its_own_thinking_and_writing_limits(self):
        dials = configured(router_reasoning_effort="high", router_max_tokens=4096)
        assert (dials.labelling().reasoning_effort, dials.labelling().answer_token_cap) == (
            "high",
            4096,
        )
        assert (dials.answering().reasoning_effort, dials.answering().answer_token_cap) == (
            "minimal",
            1024,
        )

    def test_each_role_carries_a_provider_preference_of_its_own(self):
        # They agree by default. That is a measurement rather than a
        # coincidence: sorting the labelling model by latency is the obvious
        # idea once streaming shows its call is the whole wait before the first
        # word, and it was tried on production and did not help. The dial is
        # per role so the next attempt is a dropdown rather than a deploy.
        dials = configured()
        assert (dials.answering().provider_sort, dials.labelling().provider_sort) == (
            "throughput",
            "throughput",
        )
        assert configured(router_provider_sort="latency").labelling().provider_sort == "latency"

    def test_labelling_asks_for_no_thinking_at_all(self):
        # Both production outages were a thinking setting an endpoint would not
        # take: "none" drew a 400 from a model that must think, and a positive
        # value drew a 404 from one that cannot. The empty setting sends
        # nothing, and nothing is what neither can refuse.
        assert configured().labelling().reasoning_effort == ""

    def test_one_role_thinking_is_not_another_role_thinking(self):
        # AGENT_REASONING_EFFORT is the answering role's variable. It used to
        # stand in for labelling's too, so turning one dial moved the other.
        dials = configured(reasoning_effort="high")
        assert dials.answering().reasoning_effort == "high"
        assert dials.labelling().reasoning_effort == ""

    def test_a_role_is_frozen(self):
        with pytest.raises(FrozenInstanceError):
            configured().answering().model = "openai:something-else"


class TestWhereTheDialsComeFrom:
    """Admin panel, then environment, then what the service shipped with."""

    def test_the_panel_wins_over_the_environment(self):
        dials = configured(PanelValues(model="openai:from-panel"), model="openai:from-env")
        assert dials.answering().model == "openai:from-panel"

    def test_the_environment_answers_when_the_panel_has_not(self):
        assert configured(model="openai:from-env").answering().model == "openai:from-env"

    def test_the_default_answers_when_neither_has(self):
        assert configured().answering().model == "anthropic:claude-haiku-4-5"

    def test_the_panel_can_say_send_no_thinking_instruction(self):
        # "" from the panel is a decision, not an absence, so it beats an
        # environment that asks for thought.
        dials = configured(PanelValues(router_reasoning_effort=""), router_reasoning_effort="high")
        assert dials.labelling().reasoning_effort == ""

    def test_a_labelling_model_the_panel_left_blank_falls_back_to_answering(self):
        dials = configured(PanelValues(model="openai:answers", router_model=None))
        assert dials.labelling().model == "openai:answers"

    def test_numbers_come_through_the_same_way(self):
        assert configured(tool_hops=5).tool_hops() == 5
        assert configured(PanelValues(tool_hops=2), tool_hops=5).tool_hops() == 2
        assert configured(PanelValues(context_max_positions=3)).context_max_positions() == 3

    def test_the_panel_may_turn_tools_off(self):
        assert configured(PanelValues(tool_hops=0), tool_hops=5).tool_hops() == 0

    def test_the_prompt_can_be_overridden_from_the_environment(self):
        assert configured(system_prompt="be terse").system_prompt() == "be terse"
