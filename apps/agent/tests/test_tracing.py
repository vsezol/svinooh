import json
import uuid

import pytest
from langfuse._client.resource_manager import LangfuseResourceManager
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from app.observability.tracing import configure, traced
from app.ports import Ask, Finished
from tests.support import agent, fake_model

TOKEN = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTQyIn0.c2lnbmF0dXJl"


@pytest.fixture
def exported(monkeypatch):
    monkeypatch.setenv("LANGFUSE_PUBLIC_KEY", f"pk-lf-test-{uuid.uuid4().hex}")
    monkeypatch.setenv("LANGFUSE_SECRET_KEY", "sk-lf-test")
    exporter = InMemorySpanExporter()
    configure(
        base_url="http://langfuse.invalid",
        span_exporter=exporter,
        tracer_provider=TracerProvider(),
    )
    yield exporter
    LangfuseResourceManager.reset()


def spans(exporter: InMemorySpanExporter) -> tuple[ReadableSpan, ...]:
    LangfuseResourceManager.reset()
    return exporter.get_finished_spans()


def attribute(span: ReadableSpan, key: str) -> object:
    return (span.attributes or {}).get(key)


async def test_a_streamed_turn_is_one_trace_in_its_chat_under_its_owner(exported):
    bot = agent(model=fake_model("Half of it sits in Kamino"))
    asked = Ask(question="where is my money", session_id="chat-1", owner="user:42")
    updates = [update async for update in bot.watch(asked)]
    assert isinstance(updates[-1], Finished)
    sent = spans(exported)
    assert {"LangGraph", "general", "branch_by_intent"} <= {span.name for span in sent}
    assert len({span.context.trace_id for span in sent}) == 1
    assert any(attribute(span, "langfuse.observation.type") == "generation" for span in sent)
    assert {attribute(span, "session.id") for span in sent} == {"chat-1"}
    assert {attribute(span, "user.id") for span in sent} == {"user:42"}


async def test_no_span_carries_the_callers_token(exported):
    await agent().run(Ask(question="hi", authorization=TOKEN))
    sent = spans(exported)
    values = [str(value) for span in sent for value in (span.attributes or {}).values()]
    assert values and not [value for value in values if "eyJ" in value or "Bearer e" in value]
    (graph,) = [span for span in sent if span.name == "LangGraph"]
    given = json.loads(str(attribute(graph, "langfuse.observation.input")))
    assert given["authorization"] == "[redacted]" and given["question"] == "hi"


async def test_without_keys_nothing_is_traced_and_the_turn_still_answers():
    configure()
    with traced(Ask(question="hi")) as config:
        assert config is None
    assert (await agent().run(Ask(question="hi"))).answer == "answered"
