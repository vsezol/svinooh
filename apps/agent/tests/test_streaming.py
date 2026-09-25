from langchain_core.messages import AIMessage

from app.agent.graph import ANSWERING_NODES, SPEAKING_NODES
from app.agent.streaming import turn_events
from app.domain.earn import Settled
from tests.support import Catalog, Talking, agent, fake_model

ANSWER = "Impermanent loss is a drop against holding."


def watching(**overrides):
    return agent(model=fake_model(ANSWER), **overrides)


async def collect(state: dict, bot=None) -> tuple[list[str], list[tuple[str, dict]]]:
    graph = (bot or watching()).graph
    events = [event async for event in turn_events(graph, state, answering=SPEAKING_NODES)]
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
        tokens, _ = await collect({"question": "q"}, watching(intent="general"))
        assert "general" not in tokens


class Failing:
    def __init__(self, saying="upstream is on fire"):
        self.saying = saying

    async def ainvoke(self, _messages, **_kwargs):
        raise RuntimeError(self.saying)

    async def astream(self, _messages, **_kwargs):
        raise RuntimeError(self.saying)
        yield  # pragma: no cover — makes this an async generator


class TestWhenItGoesWrong:
    async def test_a_failure_ends_the_stream_rather_than_hanging(self):
        _, events = await collect({"question": "q"}, agent(model=Failing()))
        name, data = events[-1]
        assert name == "error"
        assert "could not be finished" in data["message"]

    async def test_the_failure_is_not_handed_to_the_reader_verbatim(self):
        refusing = Failing("api_key=sk-or-v1-secret refused by provider")
        _, events = await collect({"question": "q"}, agent(model=refusing))
        assert "sk-or-v1" not in str(events), "an upstream message is not ours to forward"

    async def test_a_broken_labeller_is_not_a_broken_turn(self):
        class Broken:
            async def classify(self, _question, _history=()):
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
    def __init__(self, node):
        self.node = node

    async def astream(self, state, stream_mode=None):
        yield "values", await self.node(state)


class TestTheNodesThatSpeak:
    def test_every_leaf_is_one_the_reader_hears(self):
        edges = watching().graph.get_graph().edges
        ends_a_turn = {edge.source for edge in edges if edge.target == "__end__"}
        assert ends_a_turn == set(ANSWERING_NODES)

    def test_only_a_landing_is_not_typed_out(self):
        assert set(ANSWERING_NODES) - set(SPEAKING_NODES) == {"settled"}


LOOKED_UP = AIMessage(
    content="Here is what USDC earns right now.",
    tool_calls=[{"name": "earn_options", "args": {"token": "USDC"}, "id": "c1"}],
)


class TestWhatWasWrittenStays:
    async def test_what_it_wrote_before_looking_something_up_is_still_there_at_the_end(self):
        talking = Talking(replies=[LOOKED_UP, AIMessage(content="Pick one below.")])
        bot = agent(model=talking, intent="earn", catalog=Catalog())
        tokens, events = await collect({"question": "where do I earn on USDC?"}, bot)
        final = events[-1][1]["answer"]
        assert final == "Here is what USDC earns right now.\n\nPick one below."
        assert "".join(tokens) == final, "what was watched being written is the answer"

    async def test_a_reply_that_only_looks_something_up_adds_nothing_to_read(self):
        silent = AIMessage(content="", tool_calls=LOOKED_UP.tool_calls)
        talking = Talking(replies=[silent, AIMessage(content="Pick one below.")])
        bot = agent(model=talking, intent="earn", catalog=Catalog())
        tokens, events = await collect({"question": "where do I earn on USDC?"}, bot)
        assert events[-1][1]["answer"] == "Pick one below."
        assert "".join(tokens) == "Pick one below."

    async def test_a_landing_is_answered_whole_rather_than_typed_out(self):
        landed = Settled(amount="12", token="USDC", pool="USDC Prime", status="landed")
        bot = agent(model=fake_model(ANSWER), catalog=Catalog())
        tokens, events = await collect({"question": "", "settled": landed}, bot)
        assert tokens == [], "it may be written again before it is shown"
        assert events[-1][1]["answer"] == ANSWER


class TestAProposalKeepsWhatCameBeforeIt:
    async def test_the_words_before_a_proposal_stay_above_the_question_it_asks(self):
        proposing = AIMessage(
            content="Got it.",
            tool_calls=[
                {
                    "name": "ProposePortfolio",
                    "args": {"addresses": ["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"]},
                    "id": "p1",
                }
            ],
        )
        asking = AIMessage(content="Track this wallet? Yes or no.")
        bot = agent(model=Talking(replies=[proposing, asking]), intent="portfolio")
        tokens, events = await collect({"question": "track 9xQeWvG8"}, bot)
        final = events[-1][1]
        assert final["answer"] == "Got it.\n\nTrack this wallet? Yes or no."
        assert "".join(tokens) == final["answer"]
        assert final["pending_set"] == ["9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"]
