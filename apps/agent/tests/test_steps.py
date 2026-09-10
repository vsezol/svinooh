"""What the reader is shown about the work, and where it comes from.

The point of a trace is that it can be checked. A list of plausible-looking
things an assistant might be doing is worse than a spinner: a spinner admits it
knows nothing, and an invented step lies confidently. So the property under
test is not "a trace appears" but "every line corresponds to an operation that
actually ran, and says what it actually was".
"""

import pytest

from app.agent.graph import ANSWERING_NODES
from app.agent.steps import step, tool_label
from app.agent.streaming import turn_events
from tests.support import agent, fake_model

ANSWER = "Everything else is unlevered."


def a_turn():
    return agent(model=fake_model(ANSWER))


async def steps_of(state: dict) -> list[dict]:
    watched = turn_events(a_turn().graph, state, answering=ANSWERING_NODES)
    return [data async for name, data in watched if name == "step"]


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

    async def test_a_failure_closes_the_line_rather_than_leaving_it_spinning(self, monkeypatch):
        async def boom():
            async with step("x", "Doing the thing"):
                raise RuntimeError("no")

        seen = []
        import app.agent.steps as steps

        # The writer is the graph's; outside one there is none, so this test
        # supplies its own and asserts the same events reach it.
        #
        # Through monkeypatch, which puts it back. Set with object.__setattr__
        # it stayed set for the rest of the session, so every later test in
        # this file had its steps posted into this list instead of the stream
        # — and read an empty trace as a passing one.
        monkeypatch.setattr(steps, "_writer", lambda: seen.append)
        with pytest.raises(RuntimeError):
            await boom()
        assert [s["state"] for s in seen] == ["running", "failed"]
        assert isinstance(seen[-1]["ms"], int)


class TestNoPartOfTheWaitIsUnaccountedFor:
    """The other half of the rule.

    "Nothing on screen that did not happen" was kept from the start; this is
    the half that was missing — everything that DOES happen says so. A turn
    used to report the operations around the model and nothing about the model
    itself, so a reader watched three lines close and then sat through several
    seconds of a chat that looked frozen.
    """

    async def test_the_model_call_is_itself_an_operation(self):
        reported = await steps_of({"question": "what is impermanent loss?"})
        assert any(s.get("label") == "Writing the answer" for s in reported)

    async def test_every_line_is_closed_by_the_end_of_the_turn(self):
        # Nothing is left spinning: a line that opens and never closes is the
        # same frozen chat by another route.
        reported = await steps_of({"question": "what is impermanent loss?"})
        opened = [s["id"] for s in reported if s.get("state") == "running"]
        closed = [s["id"] for s in reported if s.get("state") in ("done", "failed")]
        assert sorted(opened) == sorted(closed)

    async def test_the_answer_is_still_the_answer(self):
        # The step is a wrapper around the call, not a change to it.
        state = await a_turn().graph.ainvoke({"question": "q"})
        assert state["answer"] == ANSWER


class TestReportingIsNeverLoadBearing:
    async def test_a_turn_runs_the_same_with_nobody_watching(self):
        # /chat does not stream, so there is no writer at all. A step must then
        # be an ordinary timer that tells nobody, not an error.
        state = await a_turn().graph.ainvoke({"question": "q"})
        assert state["answer"] == ANSWER

    async def test_a_broken_channel_does_not_fail_the_turn(self, monkeypatch):
        import app.agent.steps as steps

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
