import os

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Gauge,
    Histogram,
    generate_latest,
)

registry = CollectorRegistry()

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
    ["app", "outcome"],
    registry=registry,
)
turn_duration = Histogram(
    "svinooh_agent_turn_duration_seconds",
    "How long a whole turn took, tools and all",
    ["app"],
    buckets=(0.5, 1, 2, 3, 5, 8, 13, 21, 34, 60, 120),
    registry=registry,
)

model_calls = Counter(
    "svinooh_agent_model_calls_total",
    "Calls to a model, by the job it was doing",
    ["app", "role", "outcome"],
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
    ["app", "intent"],
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
    metric.labels(app=_APP, **labels).inc()


def timed(metric: Histogram, seconds: float, **labels: str) -> None:
    metric.labels(app=_APP, **labels).observe(seconds)


def in_flight(delta: int) -> None:
    model_in_flight.labels(app=_APP).inc(delta)


def render() -> tuple[bytes, str]:
    return generate_latest(registry), CONTENT_TYPE_LATEST
