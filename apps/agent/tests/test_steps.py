"""What the reader is shown about the work, and where it comes from.

The point of a trace is that it can be checked. A list of plausible-looking
things an assistant might be doing is worse than a spinner: a spinner admits it
knows nothing, and an invented step lies confidently. So the property under
test is not "a trace appears" but "every line corresponds to an operation that
actually ran, and says what it actually was".
"""
import asyncio

import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

import app.graph as graph
import app.intent as intent
from app.intent import IntentLabel
from app.steps import step, tool_label
from app.streaming import turn_events

ANSWER = "Everything else is unlevered."


def cached(value):
    factory = lambda: value  # noqa: E731 — one expression, named by assignment
    factory.cache_clear = lambda: None
    return factory


class Labeller:
    async def ainvoke(self, _messages):
        return IntentLabel(intent="general", reason="stubbed")


@pytest.fixture(autouse=True)
def a_turn(monkeypatch):
    monkeypatch.setattr(intent, "_labeler", cached(Labeller()))
    monkeypatch.setattr(
        graph, "get_model", lambda: GenericFakeChatModel(messages=iter([AIMessage(content=ANSWER)]))
    )
    graph.agent_graph.cache_clear()
    yield
    graph.agent_graph.cache_clear()


async def steps_of(state: dict) -> list[dict]:
    return [data async for name, data in turn_events(state) if name == "step"]


class TestWhatIsReported:
    async def test_an_operation_that_runs_is_reported(self):
        # Routing is a real model call in front of every turn, so it is a line.
        reported = await steps_of({"question": "what is a health factor?"})
        assert any(s.get("label") == "Reading the question" for s in reported)

    async def test_a_line_opens_and_closes_with_what_it_took(self):
        reported = await steps_of({"question": "q"})
        opened = [s for s in reported if s.get("state") == "running"]
        closed = [s for s in reported if s.get("state") in ("done", "failed")]
        assert opened and len(closed) == len(opened)
        assert all(isinstance(s.get("ms"), int) for s in closed)

    async def test_the_close_lands_on_the_line_it_opened(self):
        # Same id, so the reader updates a row rather than growing a second.
        reported = await steps_of({"question": "q"})
        opened = {s["id"] for s in reported if s.get("state") == "running"}
        closed = {s["id"] for s in reported if s.get("state") == "done"}
        assert closed and closed <= opened

    async def test_an_operation_that_did_not_run_is_not_reported(self):
        # The whole property. A general question never reads a portfolio, so
        # there must be no line claiming it did.
        reported = await steps_of({"question": "what is impermanent loss?"})
        labels = " ".join(str(s.get("label", "")) for s in reported)
        assert "portfolio" not in labels.lower()

    async def test_a_failure_closes_the_line_rather_than_leaving_it_spinning(self):
        async def boom():
            async with step("x", "Doing the thing"):
                raise RuntimeError("no")

        seen = []
        import app.steps as steps

        # The writer is the graph's; outside one there is none, so this test
        # supplies its own and asserts the same events reach it.
        object.__setattr__(steps, "_writer", lambda: seen.append)
        with pytest.raises(RuntimeError):
            await boom()
        assert [s["state"] for s in seen] == ["running", "failed"]
        assert isinstance(seen[-1]["ms"], int)


class TestReportingIsNeverLoadBearing:
    async def test_a_turn_runs_the_same_with_nobody_watching(self):
        # /chat does not stream, so there is no writer at all. A step must then
        # be an ordinary timer that tells nobody, not an error.
        state = await graph.agent_graph().ainvoke({"question": "q"})
        assert state["answer"] == ANSWER

    async def test_a_broken_channel_does_not_fail_the_turn(self, monkeypatch):
        import app.steps as steps

        def angry(_event):
            raise RuntimeError("pipe closed")

        monkeypatch.setattr(steps, "_writer", lambda: angry)

        async def work():
            async with step("x", "Doing the thing"):
                return 42

        assert await work() == 42


class TestHowACallIsSaid:
    def test_a_tool_is_named_by_its_own_name_and_argument(self):
        # Not prettified prose: shown the way a terminal shows a command,
        # because the point is that the reader can check it against reality.
        assert tool_label("history_summary", {"period": "7d"}) == "history_summary · 7d"
        assert tool_label("position_details", {"query": "aave"}) == "position_details · aave"

    def test_an_argumentless_call_is_just_its_name(self):
        assert tool_label("refresh", {}) == "refresh"

    def test_empty_arguments_are_not_shown_as_nothing(self):
        assert tool_label("f", {"a": "", "b": None, "c": "x"}) == "f · x"
