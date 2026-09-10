"""A turn reported while it happens, rather than after.

The answer took four to six seconds and the chat showed nothing for all of
them — almost none of it thinking, nearly all of it a model writing into a
buffer nobody could see.

These run the real graph with fake models, so what is under test is the wiring
the feature actually depends on: that the tokens of an answer can be told apart
from the tokens of a label, and that watching a turn still ends in the same
state as awaiting one.
"""

from app.agent.graph import ANSWERING_NODES
from app.agent.streaming import turn_events
from tests.support import agent, fake_model

ANSWER = "Impermanent loss is a drop against holding."


def watching(**overrides):
    """The simplest complete turn, or one shaped by the overrides."""
    return agent(model=fake_model(ANSWER), **overrides)


async def collect(state: dict, bot=None) -> tuple[list[str], list[tuple[str, dict]]]:
    graph = (bot or watching()).graph
    events = [event async for event in turn_events(graph, state, answering=ANSWERING_NODES)]
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

    async def test_the_label_is_not_streamed_at_the_reader(self):
        # The classifier runs a model too. Its output is a routing decision and
        # was never for anybody to read.
        tokens, _ = await collect({"question": "q"}, watching(intent="general"))
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
    async def test_a_failure_ends_the_stream_rather_than_hanging(self):
        # A reader owed an answer is owed an ending; a connection that simply
        # stops leaves a spinner turning forever.
        _, events = await collect({"question": "q"}, agent(model=Failing()))
        name, data = events[-1]
        assert name == "error"
        assert "could not be finished" in data["message"]

    async def test_the_failure_is_not_handed_to_the_reader_verbatim(self):
        refusing = Failing("api_key=sk-or-v1-secret refused by provider")
        _, events = await collect({"question": "q"}, agent(model=refusing))
        assert "sk-or-v1" not in str(events), "an upstream message is not ours to forward"

    async def test_a_broken_labeller_is_not_a_broken_turn(self):
        # Deliberately not an error: a classifier that cannot be reached routes
        # to the portfolio branch rather than failing the question, which is
        # the fail-safe two production outages were hiding behind. The turn
        # still has to end in an answer.
        class Broken:
            async def classify(self, _question):
                raise RuntimeError("no endpoints")

        class PublicPortfolio:
            async def portfolio(self, _ref, _token):
                raise RuntimeError("not today")

        bot = agent(model=fake_model(ANSWER), intents=Broken(), portfolio=PublicPortfolio())
        _, events = await collect({"question": "q", "portfolio": "p"}, bot)
        assert events[-1][0] == "done"

    async def test_a_turn_with_no_answer_still_ends(self):
        async def silent(_state):
            return {"answer": ""}

        events = [
            event async for event in turn_events(_OneNode(silent), {"question": "q"}, answering=())
        ]
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
        edges = watching().graph.get_graph().edges
        ends_a_turn = {edge.source for edge in edges if edge.target == "__end__"}
        assert ends_a_turn == set(ANSWERING_NODES)
