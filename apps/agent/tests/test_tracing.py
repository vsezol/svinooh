import json
import uuid

import pytest
from opentelemetry.sdk.trace import ReadableSpan, TracerProvider
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from app.observability.logs import request_id
from app.observability.tracing import TURN, Tracing, pseudonym
from app.ports import Ask, Finished
from app.settings import Settings
from tests.support import agent, fake_model

TOKEN = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTQyIn0.c2lnbmF0dXJl"


class ProviderDown:
    async def ainvoke(self, _messages):
        raise RuntimeError("provider down")


class Exported:
    def __init__(self) -> None:
        self.exporter = InMemorySpanExporter()
        self.tracing = Tracing(
            Settings(
                langfuse_public_key=f"pk-lf-test-{uuid.uuid4().hex}",
                langfuse_secret_key="sk-lf-test",
            ),
            base_url="http://langfuse.invalid",
            span_exporter=self.exporter,
            tracer_provider=TracerProvider(),
        )

    def spans(self) -> tuple[ReadableSpan, ...]:
        self.tracing.flush()
        return self.exporter.get_finished_spans()

    def named(self, name: str) -> ReadableSpan:
        (span,) = [span for span in self.spans() if span.name == name]
        return span


def attribute(span: ReadableSpan, key: str) -> object:
    return (span.attributes or {}).get(key)


def as_json(span: ReadableSpan, key: str) -> dict:
    return json.loads(str(attribute(span, key)))


@pytest.fixture
async def traced():
    exported = Exported()
    yield exported
    await exported.tracing.stop()


class TestATurnIsOneTrace:
    async def test_the_turn_is_the_root_with_the_question_in_and_the_answer_out(self, traced):
        bot = agent(model=fake_model("Half of it sits in Kamino"), tracing=traced.tracing)
        await bot.run(Ask(question="where is my money", session_id="chat-1", owner="user:42"))
        root = traced.named(TURN)
        assert root.parent is None
        assert as_json(root, "langfuse.observation.input")["question"] == "where is my money"
        assert as_json(root, "langfuse.observation.output")["answer"] == "Half of it sits in Kamino"
        assert attribute(root, "langfuse.observation.metadata.answered_by") == "general"

    async def test_the_graph_and_its_model_call_hang_under_the_turn(self, traced):
        bot = agent(tracing=traced.tracing)
        await bot.run(Ask(question="what is a health factor"))
        spans = traced.spans()
        assert {"LangGraph", "general", "branch_by_intent"} <= {span.name for span in spans}
        assert {span.context.trace_id for span in spans} == {traced.named(TURN).context.trace_id}
        assert any(attribute(s, "langfuse.observation.type") == "generation" for s in spans)

    async def test_the_chat_is_the_session_and_the_owner_is_never_named(self, traced):
        bot = agent(tracing=traced.tracing)
        await bot.run(Ask(question="hi", session_id="chat-1", owner="user:42"))
        root = traced.named(TURN)
        assert attribute(root, "session.id") == "chat-1"
        assert attribute(root, "user.id") == pseudonym("user:42")
        assert "42" not in str(attribute(root, "user.id"))

    async def test_the_request_id_in_the_logs_finds_the_trace(self, traced):
        token = request_id.set("req-7f3a")
        try:
            await agent(tracing=traced.tracing).run(Ask(question="hi"))
        finally:
            request_id.reset(token)
        assert attribute(traced.named(TURN), "langfuse.trace.metadata.request_id") == "req-7f3a"

    async def test_a_streamed_turn_is_traced_the_same_way(self, traced):
        bot = agent(model=fake_model("streamed"), tracing=traced.tracing)
        updates = [update async for update in bot.watch(Ask(question="hi", session_id="c"))]
        assert isinstance(updates[-1], Finished)
        assert as_json(traced.named(TURN), "langfuse.observation.output")["answer"] == "streamed"

    async def test_a_turn_that_breaks_is_marked_as_one(self, traced):
        bot = agent(model=ProviderDown(), tracing=traced.tracing)
        with pytest.raises(RuntimeError, match="provider down"):
            await bot.run(Ask(question="hi"))
        assert traced.named(TURN).status.status_code is StatusCode.ERROR


class TestTheTokenNeverLeaves:
    async def test_no_span_carries_the_callers_token(self, traced):
        bot = agent(tracing=traced.tracing)
        await bot.run(Ask(question="hi", authorization=TOKEN, owner="user:42"))
        sent = [str(value) for span in traced.spans() for value in (span.attributes or {}).values()]
        assert sent and not [value for value in sent if "eyJ" in value or "Bearer e" in value]

    async def test_the_state_it_was_cut_from_is_still_readable(self, traced):
        bot = agent(tracing=traced.tracing)
        await bot.run(Ask(question="hi", authorization=TOKEN))
        given = as_json(traced.named("LangGraph"), "langfuse.observation.input")
        assert given["authorization"] == "[redacted]" and given["question"] == "hi"


class TestWithoutKeys:
    @pytest.mark.parametrize("settings", [None, Settings(langfuse_public_key="pk-lf-only")])
    def test_both_keys_are_needed_to_send_anything(self, settings):
        with Tracing(settings).turn(Ask(question="hi")) as traced:
            assert traced.config is None and traced.observation is None

    async def test_an_untraced_turn_still_answers(self):
        assert (await agent(tracing=Tracing()).run(Ask(question="hi"))).answer == "answered"
