import pytest

from app.agent.graph import ANSWERING_NODES
from app.agent.steps import said, step, tool_label
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
        reported = await steps_of({"question": "what is a health factor?"})
        assert any(s.get("label") == "Reading the question" for s in reported)

    async def test_a_line_opens_and_closes_with_what_it_took(self):
        reported = await steps_of({"question": "q"})
        opened = [s for s in reported if s.get("state") == "running"]
        closed = [s for s in reported if s.get("state") in ("done", "failed")]
        assert opened and len(closed) == len(opened)
        assert all(isinstance(s.get("ms"), int) for s in closed)

    async def test_the_close_lands_on_the_line_it_opened(self):
        reported = await steps_of({"question": "q"})
        opened = {s["id"] for s in reported if s.get("state") == "running"}
        closed = {s["id"] for s in reported if s.get("state") == "done"}
        assert closed and closed <= opened

    async def test_an_operation_that_did_not_run_is_not_reported(self):
        reported = await steps_of({"question": "what is impermanent loss?"})
        labels = " ".join(str(s.get("label", "")) for s in reported)
        assert "portfolio" not in labels.lower()

    async def test_a_failure_closes_the_line_rather_than_leaving_it_spinning(self, monkeypatch):
        async def boom():
            async with step("x", "Doing the thing"):
                raise RuntimeError("no")

        seen = []
        import app.agent.steps as steps

        monkeypatch.setattr(steps, "_writer", lambda: seen.append)
        with pytest.raises(RuntimeError):
            await boom()
        assert [s["state"] for s in seen] == ["running", "failed"]
        assert isinstance(seen[-1]["ms"], int)


class TestWhatCameBackIsOnTheLine:
    async def test_the_close_carries_what_the_operation_found(self, monkeypatch):
        seen = []
        import app.agent.steps as steps

        monkeypatch.setattr(steps, "_writer", lambda: seen.append)

        async def reads():
            async with step("x", "Reading lending rates"):
                said("8 pools · best 16.91%")

        await reads()
        assert seen[-1]["state"] == "done"
        assert seen[-1]["detail"] == "8 pools · best 16.91%"

    async def test_a_line_that_found_nothing_to_say_carries_nothing(self, monkeypatch):
        seen = []
        import app.agent.steps as steps

        monkeypatch.setattr(steps, "_writer", lambda: seen.append)

        async def quiet():
            async with step("x", "Thinking"):
                pass

        await quiet()
        assert "detail" not in seen[-1]

    async def test_saying_it_outside_a_step_is_not_an_error(self):
        said("nobody is listening")


class TestNoPartOfTheWaitIsUnaccountedFor:
    async def test_the_model_call_is_itself_an_operation(self):
        reported = await steps_of({"question": "what is impermanent loss?"})
        assert any(s.get("label") == "Writing the answer" for s in reported)

    async def test_every_line_is_closed_by_the_end_of_the_turn(self):
        reported = await steps_of({"question": "what is impermanent loss?"})
        opened = [s["id"] for s in reported if s.get("state") == "running"]
        closed = [s["id"] for s in reported if s.get("state") in ("done", "failed")]
        assert sorted(opened) == sorted(closed)

    async def test_the_answer_is_still_the_answer(self):
        state = await a_turn().graph.ainvoke({"question": "q"})
        assert state["answer"] == ANSWER


class TestReportingIsNeverLoadBearing:
    async def test_a_turn_runs_the_same_with_nobody_watching(self):
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
        assert tool_label("history_summary", {"period": "7d"}) == "history_summary · 7d"
        assert tool_label("position_details", {"query": "aave"}) == "position_details · aave"

    def test_an_argumentless_call_is_just_its_name(self):
        assert tool_label("refresh", {}) == "refresh"

    def test_empty_arguments_are_not_shown_as_nothing(self):
        assert tool_label("f", {"a": "", "b": None, "c": "x"}) == "f · x"
