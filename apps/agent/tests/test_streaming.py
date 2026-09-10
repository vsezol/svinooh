"""A turn reported while it happens, rather than after.

The answer took four to six seconds and the chat showed nothing for all of
them — almost none of it thinking, nearly all of it a model writing into a
buffer nobody could see.

These run the real graph with fake models, so what is under test is the wiring
the feature actually depends on: that the tokens of an answer can be told apart
from the tokens of a label, and that watching a turn still ends in the same
state as awaiting one.
"""
import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

import app.agent.graph as graph
import app.agent.intent as intent
import app.agent.streaming as streaming
from app.agent.intent import IntentLabel
from app.agent.streaming import turn_events

ANSWER = "Impermanent loss is a drop against holding."


class FakeChatModel(GenericFakeChatModel):
    """The stand-in, plus the one thing the graph does to a real model.

    The onboarding branch binds a tool before it asks — for a visitor as well
    as for an account, since #180 — and `GenericFakeChatModel` raises on
    `bind_tools`. Without this, a turn that lands on onboarding fails here for
    a reason that exists only in the fake.
    """

    def bind_tools(self, _tools):
        return self


def fake_model(text: str):
    return FakeChatModel(messages=iter([AIMessage(content=text)]))


def cached(value):
    factory = lambda: value  # noqa: E731 — one expression, named by assignment
    factory.cache_clear = lambda: None
    return factory


class Labeller:
    """Stands in for the classifier, which does not stream to anybody."""

    def __init__(self, label="general"):
        self.label = label

    async def ainvoke(self, _messages):
        return IntentLabel(intent=self.label, reason="stubbed")


@pytest.fixture(autouse=True)
def a_general_question(monkeypatch):
    """The simplest complete turn: label it, answer it."""
    monkeypatch.setattr(intent, "_labeler", cached(Labeller()))
    monkeypatch.setattr(graph, "get_model", lambda: fake_model(ANSWER))
    graph.agent_graph.cache_clear()
    yield
    graph.agent_graph.cache_clear()


async def collect(state: dict) -> tuple[list[str], list[tuple[str, dict]]]:
    events = [event async for event in turn_events(state)]
    return [data["text"] for name, data in events if name == "token"], events


class TestWatchingATurn:
    async def test_the_answer_arrives_in_pieces(self):
        tokens, _ = await collect({"question": "what is impermanent loss?"})
        assert len(tokens) > 1, "one piece is not a stream"
        assert "".join(tokens) == ANSWER

    async def test_it_ends_in_the_same_state_as_awaiting_it(self):
        _, events = await collect({"question": "what is impermanent loss?"})
        name, final = events[-1]
        assert name == "done"
        assert final["answer"] == ANSWER, "the finished answer, not the pieces"

    async def test_done_comes_exactly_once_and_last(self):
        _, events = await collect({"question": "q"})
        assert [name for name, _ in events].count("done") == 1
        assert events[-1][0] == "done"

    async def test_the_label_is_not_streamed_at_the_reader(self, monkeypatch):
        # The classifier runs a model too. Its output is a routing decision and
        # was never for anybody to read.
        monkeypatch.setattr(intent, "_labeler", cached(Labeller(label="general")))
        tokens, _ = await collect({"question": "q"})
        assert "general" not in tokens


class Failing:
    """A model that refuses, however it is called."""

    def __init__(self, saying="upstream is on fire"):
        self.saying = saying

    async def ainvoke(self, _messages, **_kwargs):
        raise RuntimeError(self.saying)

    async def astream(self, _messages, **_kwargs):
        raise RuntimeError(self.saying)
        yield  # pragma: no cover — makes this an async generator


class TestWhenItGoesWrong:
    async def test_a_failure_ends_the_stream_rather_than_hanging(self, monkeypatch):
        # A reader owed an answer is owed an ending; a connection that simply
        # stops leaves a spinner turning forever.
        monkeypatch.setattr(graph, "get_model", lambda: Failing())
        graph.agent_graph.cache_clear()
        _, events = await collect({"question": "q"})
        name, data = events[-1]
        assert name == "error"
        assert "could not be finished" in data["message"]

    async def test_the_failure_is_not_handed_to_the_reader_verbatim(self, monkeypatch):
        monkeypatch.setattr(
            graph, "get_model", lambda: Failing("api_key=sk-or-v1-secret refused by provider")
        )
        graph.agent_graph.cache_clear()
        _, events = await collect({"question": "q"})
        assert "sk-or-v1" not in str(events), "an upstream message is not ours to forward"

    async def test_a_broken_labeller_is_not_a_broken_turn(self, monkeypatch):
        # Deliberately not an error: a classifier that cannot be reached routes
        # to the portfolio branch rather than failing the question, which is
        # the fail-safe two production outages were hiding behind. The turn
        # still has to end in an answer.
        class Broken:
            async def ainvoke(self, _messages):
                raise RuntimeError("no endpoints")

        monkeypatch.setattr(intent, "_labeler", cached(Broken()))
        graph.agent_graph.cache_clear()
        _, events = await collect({"question": "q"})
        assert events[-1][0] == "done"

    async def test_a_turn_with_no_answer_still_ends(self, monkeypatch):
        async def silent(_state):
            return {"answer": ""}

        monkeypatch.setattr(streaming, "agent_graph", lambda: _OneNode(silent))
        _, events = await collect({"question": "q"})
        assert events[-1][0] == "error"


class _OneNode:
    """A graph stand-in that yields a final state and no tokens."""

    def __init__(self, node):
        self.node = node

    async def astream(self, state, stream_mode=None):
        yield "values", await self.node(state)


class TestTheNodesThatSpeak:
    def test_every_leaf_is_one_the_reader_hears(self):
        # A node that ends a turn writes the reply, so the two lists are the
        # same list — which is why there is only one of them.
        edges = graph.agent_graph().get_graph().edges
        ends_a_turn = {edge.source for edge in edges if edge.target == "__end__"}
        assert ends_a_turn == set(graph.ANSWERING_NODES)
