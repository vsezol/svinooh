import json

import pytest

from app.domain.identity import ANON_HEADER
from tests.support import Catalog, Meter, client_for, container, fake_model

ANSWER = "A health factor is a safety margin."


class Model:
    def __init__(self):
        self._called = False

    def bind_tools(self, _tools):
        return self

    async def ainvoke(self, _messages, **_kwargs):
        called, self._called = self._called, True

        class Reply:
            content = "Sign it in your wallet when you are ready."
            tool_calls = (
                []
                if called
                else [
                    {
                        "name": "propose_deposit",
                        "args": {"pool_id": "sol:kamino:vault:AAA", "amount": "250"},
                        "id": "d1",
                    }
                ]
            )

        return Reply()

    async def astream(self, messages, **kwargs):
        reply = await self.ainvoke(messages, **kwargs)
        yield reply


class Failing:
    async def ainvoke(self, _messages, **_kwargs):
        raise RuntimeError("upstream is on fire")

    async def astream(self, _messages, **_kwargs):
        raise RuntimeError("upstream is on fire")
        yield  # pragma: no cover — makes this an async generator


@pytest.fixture
def meter():
    return Meter()


@pytest.fixture
def wired(meter):
    return container(model=fake_model(ANSWER), limiter=meter)


@pytest.fixture
async def client(wired):
    async with client_for(wired) as client:
        yield client


def parse(body: str) -> list[tuple[str, dict]]:
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
        streamed = parse((await client.post("/chat/stream", json={"message": "q"})).text)[-1][1]
        whole = (await client.post("/chat", json={"message": "q"})).json()
        assert streamed["schema"] == whole["schema"]
        assert streamed["blocks"] == whole["blocks"]
        assert set(streamed) == set(whole)

    async def test_a_session_is_named_at_both_ends(self, client):
        events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        opened = events[0][1]["session_id"]
        assert opened and events[-1][1]["session_id"] == opened


class TestItIsTheSameTurn:
    async def test_the_session_remembers_a_streamed_turn(self, client, wired):
        events = parse((await client.post("/chat/stream", json={"message": "hello"})).text)
        session = events[-1][1]["session_id"]
        remembered = await wired.sessions.history(session)
        assert [(t.q, t.a) for t in remembered] == [("hello", ANSWER)]

    async def test_and_carries_it_into_the_next_question(self, client, wired):
        first = parse((await client.post("/chat/stream", json={"message": "hello"})).text)
        session = first[-1][1]["session_id"]
        await client.post("/chat/stream", json={"message": "again", "session_id": session})
        assert [t.q for t in await wired.sessions.history(session)] == ["hello", "again"]


class TestRefusals:
    async def test_an_empty_message_is_refused_before_anything_opens(self, client):
        response = await client.post("/chat/stream", json={"message": "   "})
        assert response.status_code == 400
        assert "text/event-stream" not in response.headers.get("content-type", "")

    async def test_a_rate_limited_caller_gets_a_status_not_a_stream(self, client, meter):
        meter.wait = 42
        response = await client.post("/chat/stream", json={"message": "q"})
        assert response.status_code == 429
        assert response.headers["retry-after"] == "42"

    async def test_a_turn_that_fails_says_so_in_the_stream(self):
        async with client_for(container(model=Failing())) as client:
            events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        assert events[0][0] == "start" and events[-1][0] == "error"

    async def test_a_failed_turn_leaves_the_session_as_it_was(self):
        wired = container(model=Failing())
        async with client_for(wired) as client:
            events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        session = events[0][1]["session_id"]
        assert await wired.sessions.history(session) == (), (
            "a question with no answer is not a turn"
        )


class TestTheOldWayStillWorks:
    async def test_chat_still_answers_whole(self, client):
        response = await client.post("/chat", json={"message": "q"})
        assert response.status_code == 200
        assert response.json()["reply"] == ANSWER


class TestADepositOnTheWire:
    @pytest.fixture
    def wired(self, meter):
        return container(
            model=Model(),
            limiter=meter,
            intent="earn",
            asked_to_place=True,
            catalog=Catalog(),
        )

    async def test_it_rides_beside_the_answer(self, client):
        answered = await client.post("/chat", json={"message": "put 250 USDC to work"})
        blocks = answered.json()["blocks"]
        assert [b["kind"] for b in blocks] == ["text", "deposit"]
        card = blocks[1]
        assert (card["amount"], card["token"], card["network"]) == ("250", "USDC", "sol")
        assert (card["kind"], card["poolKind"]) == ("deposit", "vault")
        assert card["poolId"] == "sol:kamino:vault:AAA"

    async def test_the_stream_ends_with_the_same_card(self, client):
        response = await client.post("/chat/stream", json={"message": "put 250 USDC to work"})
        done = [data for name, data in parse(response.text) if name == "done"]
        assert [b["kind"] for b in done[0]["blocks"]] == ["text", "deposit"]

    async def test_reopening_the_conversation_still_shows_it(self, client):
        who = {ANON_HEADER: "anon-deposit"}
        answered = await client.post("/chat", json={"message": "put 250 USDC to work"}, headers=who)
        session = answered.json()["session_id"]
        reopened = await client.get(f"/chats/{session}", headers=who)
        assert [b["kind"] for b in reopened.json()["turns"][0]["blocks"]] == ["text", "deposit"]
