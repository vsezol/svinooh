"""The dials a turn runs on, and where each one was set.

Three layers, in the product's own order: the admin panel, then the
environment, then what the service shipped with. An operator's decision wins,
the environment still works when nothing has been decided, and the default
runs before either exists. `Settings` (app/settings.py) is the environment,
`Panel` (app/ports.py) the panel; this module is the arithmetic between them.

What the model is TOLD is not a dial and is not here: app/agent/prompts.py.
"""

from dataclasses import dataclass

from .panel import ProductFact
from .ports import Panel
from .settings import Settings


@dataclass(frozen=True)
class Role:
    """A job the service gives a model, and the dials that job wants.

    The model that answers is read by a person and can afford to think; the
    model that labels picks one word out of two and must not keep anyone
    waiting. Each has its own dials so those choices can move apart.
    """

    #: What the job is called, for logs and for reading this code.
    name: str
    #: "<provider>:<model>" — which model does it.
    model: str
    #: How much it may think first: none/minimal/low/medium/high, or empty for
    #: "we send no instruction", the only value every model can honour.
    reasoning_effort: str
    #: The longest reply it may write, in model tokens.
    answer_token_cap: int
    #: Which of an aggregator's providers to prefer: "throughput" for a job
    #: that writes a lot, "latency" for one whose whole cost is the first word.
    provider_sort: str = "throughput"


class Config:
    """Panel, then environment, then default: the resolution, dial by dial."""

    def __init__(self, settings: Settings, panel: Panel) -> None:
        self.settings = settings
        self._panel = panel

    def answering(self) -> Role:
        """Answers — what the user reads. Thinks a little; somebody is watching a cursor."""
        decided, env = self._panel.current(), self.settings
        return Role(
            name="answering",
            model=decided.model or env.model,
            reasoning_effort=_first(decided.reasoning_effort, env.reasoning_effort),
            answer_token_cap=decided.max_tokens or env.max_tokens,
            provider_sort=decided.provider_sort or env.provider_sort,
        )

    def labelling(self) -> Role:
        """Labels — the intent and confirmation classifiers, a dozen tokens each.

        A role with no model of its own does its job on the answering one, so
        it works before anybody configures it.
        """
        decided, env = self._panel.current(), self.settings
        return Role(
            name="labelling",
            model=decided.router_model or env.router_model or self.answering().model,
            reasoning_effort=_first(decided.router_reasoning_effort, env.router_reasoning_effort),
            answer_token_cap=decided.router_max_tokens or env.router_max_tokens,
            provider_sort=decided.router_provider_sort or env.router_provider_sort,
        )

    def tool_hops(self) -> int:
        """How many rounds of looking things up one answer may take."""
        return _first(self._panel.current().tool_hops, self.settings.tool_hops)

    def context_max_positions(self) -> int:
        """How many positions per wallet the model is shown, largest first."""
        return _first(
            self._panel.current().context_max_positions, self.settings.context_max_positions
        )

    @property
    def product(self) -> tuple[ProductFact, ...]:
        """What the product currently says about itself, for the prompt."""
        return self._panel.current().product


def _first[T](decided: T | None, otherwise: T) -> T:
    """The panel's value when it has one: "" and 0 count, None does not."""
    return otherwise if decided is None else decided
