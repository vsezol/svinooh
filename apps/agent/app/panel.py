from dataclasses import dataclass


@dataclass(frozen=True)
class ProductFact:
    q: str
    a: str


@dataclass(frozen=True)
class PanelValues:
    model: str | None = None
    reasoning_effort: str | None = None
    max_tokens: int | None = None
    provider_sort: str | None = None
    router_model: str | None = None
    router_reasoning_effort: str | None = None
    router_max_tokens: int | None = None
    router_provider_sort: str | None = None
    tool_hops: int | None = None
    context_max_positions: int | None = None
    tracing: bool | None = None
    product: tuple[ProductFact, ...] = ()


NOTHING_DECIDED = PanelValues()
