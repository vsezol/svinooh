"""What the admin panel decided, as the service sees it.

The panel is the operator's hand on the dials: which model answers, how hard
it may think, how many tool rounds a turn gets, and what the product says
about itself. The values arrive over HTTP (app/adapters/panel.py, behind
ports.Panel) and app/config.py layers them over the environment. `None` is
"no opinion", so the next layer answers; an empty string is a decision.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ProductFact:
    """One question the FAQ page answers, given to the model verbatim."""

    q: str
    a: str


@dataclass(frozen=True)
class PanelValues:
    model: str | None = None
    #: "" here is a decision: send no thinking instruction at all.
    reasoning_effort: str | None = None
    max_tokens: int | None = None
    provider_sort: str | None = None
    router_model: str | None = None
    router_reasoning_effort: str | None = None
    router_max_tokens: int | None = None
    router_provider_sort: str | None = None
    tool_hops: int | None = None
    context_max_positions: int | None = None
    product: tuple[ProductFact, ...] = ()


#: The panel before anything was heard from it.
NOTHING_DECIDED = PanelValues()
