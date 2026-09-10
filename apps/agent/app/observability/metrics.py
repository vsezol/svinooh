"""What this service counts about itself.

Named to match the rest of the product (`svinooh_*`, an `app` label from
SERVICE_NAME), so one Grafana panel can hold every service — the HTTP
counters are deliberately the same metric as the api's and the wallet's.
What is the agent's own is underneath: turns, the models they call, and the
tools they call.

Every label here is bounded on purpose. A route is a template and never a
path, a role is one of two, a tool is one of two, an outcome is a small word.
Nothing is labelled by a caller, a conversation or a portfolio: that is the
difference between a metric and an unbounded bill.
"""

import os

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

#: Our own registry rather than the library's global one: what this service
#: exposes is what this module declares, and an import somewhere else cannot
#: quietly add to it.
registry = CollectorRegistry()

#: Which service these came from, on every series, like the other services.
_APP = os.getenv("SERVICE_NAME", "agent")

http_requests = Counter(
    "svinooh_http_requests_total",
    "HTTP requests total",
    ["app", "method", "route", "status"],
    registry=registry,
)
http_duration = Histogram(
    "svinooh_http_request_duration_seconds",
    "HTTP request duration in seconds",
    ["app", "method", "route", "status"],
    buckets=(0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10),
    registry=registry,
)

turns = Counter(
    "svinooh_agent_turns_total",
    "Chat turns by how they ended",
    ["app", "outcome"],  # answered | walled | timed_out | failed
    registry=registry,
)
turn_duration = Histogram(
    "svinooh_agent_turn_duration_seconds",
    "How long a whole turn took, tools and all",
    ["app"],
    # A turn is several model calls: the interesting range is seconds, and
    # the tail past a minute is what a deadline exists for.
    buckets=(0.5, 1, 2, 3, 5, 8, 13, 21, 34, 60, 120),
    registry=registry,
)

model_calls = Counter(
    "svinooh_agent_model_calls_total",
    "Calls to a model, by the job it was doing",
    ["app", "role", "outcome"],  # role: answering | labelling
    registry=registry,
)
model_duration = Histogram(
    "svinooh_agent_model_duration_seconds",
    "How long one model call took",
    ["app", "role"],
    buckets=(0.2, 0.5, 1, 2, 3, 5, 8, 13, 21, 34),
    registry=registry,
)
model_in_flight = Gauge(
    "svinooh_agent_model_calls_in_flight",
    "Model calls in the air right now, across every turn",
    ["app"],
    registry=registry,
)

intents = Counter(
    "svinooh_agent_intents_total",
    "How turns were labelled",
    ["app", "intent"],  # portfolio | general | unreadable
    registry=registry,
)
tool_calls = Counter(
    "svinooh_agent_tool_calls_total",
    "Drill-down tools the model asked for",
    ["app", "tool", "outcome"],
    registry=registry,
)
errors = Counter(
    "svinooh_errors_total",
    "Errors by type",
    ["app", "type"],
    registry=registry,
)


def counted(metric: Counter, **labels: str) -> None:
    """One event, with the app label filled in."""
    metric.labels(app=_APP, **labels).inc()


def timed(metric: Histogram, seconds: float, **labels: str) -> None:
    metric.labels(app=_APP, **labels).observe(seconds)


def in_flight(delta: int) -> None:
    model_in_flight.labels(app=_APP).inc(delta)


def render() -> tuple[bytes, str]:
    """The scrape body and its content type."""
    return generate_latest(registry), CONTENT_TYPE_LATEST
