"""The streaming endpoint, over a real ASGI transport.

The layer below (tests/test_streaming.py) proves the graph can be watched.
This proves the wire: that the events are shaped the way an EventSource parser
expects, that a refusal is a status code rather than a stream that opens and
apologises, and that a turn watched leaves the session exactly as a turn
awaited does.
"""
import json

import httpx
import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

import app.agent.graph as graph
import app.agent.intent as intent
import app.api.routes as routes
from app import create_app
from app.adapters.memory import MemoryConversationStore
from app.agent.intent import IntentLabel

ANSWER = "A health factor is a safety margin."


def cached(value):
    factory = lambda: value  # noqa: E731 — one expression, named by assignment
    factory.cache_clear = lambda: None
    return factory


class Labeller:
    async def ainvoke(self, _messages):
        return IntentLabel(intent="general", reason="stubbed")


@pytest.fixture(autouse=True)
def a_working_turn(monkeypatch):
    monkeypatch.setattr(intent, "_labeler", cached(Labeller()))
    monkeypatch.setattr(
        graph, "get_model", lambda: GenericFakeChatModel(messages=iter([AIMessage(content=ANSWER)]))
    )
    graph.agent_graph.cache_clear()
    # A fresh store per test: these assert on what a session remembers. An
    # empty url is the in-memory backend, so the suite stays offline.
    routes.sessions.__init__(MemoryConversationStore(), 40, 100)
    yield
    graph.agent_graph.cache_clear()


@pytest.fixture
async def client():
    app = create_app(cors_origins=[])
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://agent"
    ) as client:
        yield client


def parse(body: str) -> list[tuple[str, dict]]:
    """The events an EventSource would have seen."""
    events = []
    for block in body.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines() if ": " in line)
        if "event" in lines:
            events.append((lines["event"], json.loads(lines.get("data", "{}"))))
    return events


class TestTheStream:
    async def test_it_is_served_as_an_event_stream(self, client):
        async with client.stream("POST", "/chat/stream", json={"message": "q"}) as response:
            assert response.status_code == 200
            assert response.headers["content-type"].startswith("text/event-stream")
            # Without this a proxy may hold the whole stream and hand it over
            # at the end, which is the thing being fixed.
            assert response.headers["x-accel-buffering"] == "no"
            await response.aread()

    async def test_something_is_said_before_the_model_is_asked(self, client):
        response = await client.post("/chat/stream", json={"message": "q"})
        assert parse(response.text)[0][0] == "start", "a chat has to show it heard you"

    async def test_the_answer_arrives_in_pieces_and_then_whole(self, client):
        events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        pieces = [data["text"] for name, data in events if name == "token"]
        assert len(pieces) > 1 and "".join(pieces) == ANSWER
        name, done = events[-1]
        assert name == "done" and done["reply"] == ANSWER

    async def test_the_end_is_the_body_the_other_endpoint_returns(self, client):
        # One wire, two deliveries. A second shape here would be a second
        # contract to keep in step with the first.
        streamed = parse((await client.post("/chat/stream", json={"message": "q"})).text)[-1][1]
        graph.agent_graph.cache_clear()
        whole = (await client.post("/chat", json={"message": "q"})).json()
        assert streamed["schema"] == whole["schema"]
        assert streamed["blocks"] == whole["blocks"]
        assert set(streamed) == set(whole)

    async def test_a_session_is_named_at_both_ends(self, client):
        events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        opened = events[0][1]["session_id"]
        assert opened and events[-1][1]["session_id"] == opened


class TestItIsTheSameTurn:
    async def test_the_session_remembers_a_streamed_turn(self, client):
        events = parse((await client.post("/chat/stream", json={"message": "hello"})).text)
        session = events[-1][1]["session_id"]
        remembered = await routes.sessions.history(session)
        assert [message.content for message in remembered] == ["hello", ANSWER]

    async def test_and_carries_it_into_the_next_question(self, client):
        first = parse((await client.post("/chat/stream", json={"message": "hello"})).text)
        session = first[-1][1]["session_id"]
        graph.agent_graph.cache_clear()
        await client.post("/chat/stream", json={"message": "again", "session_id": session})
        assert len(await routes.sessions.history(session)) == 4


class TestRefusals:
    async def test_an_empty_message_is_refused_before_anything_opens(self, client):
        response = await client.post("/chat/stream", json={"message": "   "})
        assert response.status_code == 400
        assert "text/event-stream" not in response.headers.get("content-type", "")

    async def test_a_rate_limited_caller_gets_a_status_not_a_stream(self, client, monkeypatch):
        async def full(_key):
            return 42

        monkeypatch.setattr(routes.limiter, "retry_after", full)
        response = await client.post("/chat/stream", json={"message": "q"})
        assert response.status_code == 429
        assert response.headers["retry-after"] == "42"

    async def test_a_turn_that_fails_says_so_in_the_stream(self, client, monkeypatch):
        class Failing:
            async def ainvoke(self, _messages, **_kwargs):
                raise RuntimeError("upstream is on fire")

            async def astream(self, _messages, **_kwargs):
                raise RuntimeError("upstream is on fire")
                yield  # pragma: no cover — makes this an async generator

        monkeypatch.setattr(graph, "get_model", lambda: Failing())
        graph.agent_graph.cache_clear()
        events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        # It opened, so the failure cannot be a status code any more.
        assert events[0][0] == "start" and events[-1][0] == "error"

    async def test_a_failed_turn_leaves_the_session_as_it_was(self, client, monkeypatch):
        class Failing:
            async def ainvoke(self, _messages, **_kwargs):
                raise RuntimeError("nope")

            async def astream(self, _messages, **_kwargs):
                raise RuntimeError("nope")
                yield  # pragma: no cover

        monkeypatch.setattr(graph, "get_model", lambda: Failing())
        graph.agent_graph.cache_clear()
        events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        session = events[0][1]["session_id"]
        assert await routes.sessions.history(session) == [], (
            "a question with no answer is not a turn"
        )


class TestTheOldWayStillWorks:
    async def test_chat_still_answers_whole(self, client):
        response = await client.post("/chat", json={"message": "q"})
        assert response.status_code == 200
        assert response.json()["reply"] == ANSWER
