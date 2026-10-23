from dataclasses import dataclass

from .panel import ProductFact
from .ports import Panel
from .settings import Settings


@dataclass(frozen=True)
class Role:
    name: str
    model: str
    reasoning_effort: str
    answer_token_cap: int
    provider_sort: str = "throughput"


class Config:
    def __init__(self, settings: Settings, panel: Panel) -> None:
        self.settings = settings
        self._panel = panel

    def answering(self) -> Role:
        decided, env = self._panel.current(), self.settings
        return Role(
            name="answering",
            model=decided.model or env.model,
            reasoning_effort=_first(decided.reasoning_effort, env.reasoning_effort),
            answer_token_cap=decided.max_tokens or env.max_tokens,
            provider_sort=decided.provider_sort or env.provider_sort,
        )

    def labelling(self) -> Role:
        decided, env = self._panel.current(), self.settings
        return Role(
            name="labelling",
            model=decided.router_model or env.router_model or self.answering().model,
            reasoning_effort=_first(decided.router_reasoning_effort, env.router_reasoning_effort),
            answer_token_cap=decided.router_max_tokens or env.router_max_tokens,
            provider_sort=decided.router_provider_sort or env.router_provider_sort,
        )

    def tool_hops(self) -> int:
        return _first(self._panel.current().tool_hops, self.settings.tool_hops)

    def tracing(self) -> bool:
        return _first(self._panel.current().tracing, self.settings.tracing)

    def context_max_positions(self) -> int:
        return _first(
            self._panel.current().context_max_positions, self.settings.context_max_positions
        )

    @property
    def product(self) -> tuple[ProductFact, ...]:
        return self._panel.current().product


def _first[T](decided: T | None, otherwise: T) -> T:
    return otherwise if decided is None else decided
