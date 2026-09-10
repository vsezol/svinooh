"""What happens when more than one person is asking.

The rest of the suite is about one turn being right. These are about the
things that only go wrong with several: an unbounded question, a turn that
never ends, a burst of model calls, a cache that only grows, a socket per
request. Each of them is fine at one request a minute, which is exactly why
they need a test rather than a look.
"""

import asyncio
from dataclasses import replace

import httpx
import pytest
from langchain_core.messages import AIMessage
from redis.asyncio import ConnectionPool

from app.adapters.memory import StaticPanel
from app.adapters.portfolio import PortfolioApiSource
from app.application.auth import Authenticator
from app.application.turns import Question, Turns
from app.config import Config
from app.domain.errors import MessageTooLongError, TurnTimedOutError
from app.domain.identity import Caller
from app.domain.portfolio import Me
from app.ports import Ask, Finished, Progress, Reply
from app.settings import Settings
from tests.support import client_for, container, models_of


def turns_of(wired, agent, *, deadline_s: float = 30.0, message_max_chars: int = 4000) -> Turns:
    """The use case over one container's collaborators and this agent."""
    return Turns(
        wired.sessions,
        wired.identity,
        wired.limiter,
        wired.allowance,
        agent,
        deadline_s,
        message_max_chars,
    )


class Slow:
    """An agent whose turn never finishes in time."""

    async def run(self, ask: Ask) -> Reply:
        await asyncio.sleep(30)
        raise AssertionError("the deadline should have fired")

    async def watch(self, ask: Ask):
        yield Progress(kind="step", payload={"id": "x", "label": "Thinking", "state": "running"})
        await asyncio.sleep(30)
        yield Finished(Reply(answer="never"))


class TestAQuestionCannotBeUnbounded:
    async def test_a_message_past_the_cap_is_refused(self):
        wired = container()
        turns = turns_of(wired, None, message_max_chars=10)
        with pytest.raises(MessageTooLongError):
            await turns.admit(Caller(), Question(message="x" * 11))

    async def test_the_refusal_says_what_the_cap_is(self):
        wired = container()
        short = replace(wired, turns=turns_of(wired, None, message_max_chars=10))
        async with client_for(short) as client:
            response = await client.post("/chat", json={"message": "x" * 11})
        assert response.status_code == 413
        assert "at most 10 characters" in response.json()["detail"]

    async def test_the_cap_is_measured_after_the_trimming(self):
        wired = container()
        turns = turns_of(wired, None, message_max_chars=4)
        admitted = await turns.admit(Caller(), Question(message="  hi  "))
        assert admitted.question == "hi"

    @pytest.mark.parametrize("field", ["session_id", "portfolio"])
    async def test_an_id_of_a_megabyte_never_reaches_a_storage_key(self, field):
        async with client_for(container()) as client:
            response = await client.post("/chat", json={"message": "q", field: "x" * 5000})
        assert response.status_code == 422, "refused by the wire, before anything reads it"


class TestATurnHasADeadline:
    async def test_a_turn_that_runs_long_is_given_up_on(self):
        wired = container()
        turns = turns_of(wired, Slow(), deadline_s=0.01)
        admitted = await turns.admit(Caller(), Question(message="hello"))
        with pytest.raises(TurnTimedOutError):
            await turns.answer(admitted)

    async def test_and_the_caller_is_told_so_rather_than_held(self):
        wired = container()
        slow = replace(wired, turns=turns_of(wired, Slow(), deadline_s=0.01))
        async with client_for(slow) as client:
            response = await client.post("/chat", json={"message": "hello"})
        assert response.status_code == 504
        assert response.json() == {"detail": "the answer took too long"}

    async def test_a_watched_turn_ends_in_an_event_rather_than_a_status(self):
        # The stream is already open by then, so the reader is owed an ending
        # in the only channel there is left.
        wired = container()
        turns = turns_of(wired, Slow(), deadline_s=0.01)
        admitted = await turns.admit(Caller(), Question(message="hello"))
        events = [event async for event in turns.watch(admitted)]
        assert events[-1] == ("error", {"message": "the answer took too long"})
        assert events[0][0] == "step", "what did run is still reported"

    async def test_a_turn_that_finishes_in_time_is_untouched(self):
        wired = container()
        turns = turns_of(wired, wired.agent, deadline_s=30)
        admitted = await turns.admit(Caller(), Question(message="hello"))
        assert await turns.answer(admitted) == "answered"


class Counting:
    """A model that says how many calls were inside it at once."""

    def __init__(self, hold: float = 0.02) -> None:
        self.hold = hold
        self.now = 0
        self.peak = 0

    def bind_tools(self, _tools):
        return self

    async def ainvoke(self, _messages):
        self.now += 1
        self.peak = max(self.peak, self.now)
        await asyncio.sleep(self.hold)
        self.now -= 1
        return AIMessage(content="answered")


class TestModelCallsQueue:
    async def test_only_so_many_are_in_the_air_at_once(self):
        # The provider rate-limits us anyway; the point of queueing here is
        # that a burst waits in one place instead of arriving as 429s.
        counting = Counting()
        settings = Settings(model_max_in_flight=2)
        models = models_of(counting, settings)
        role = Config(settings, StaticPanel()).answering()
        await asyncio.gather(*(models.ask(role, []) for _ in range(6)))
        assert counting.peak == 2, f"{counting.peak} calls were in flight at once"

    async def test_and_every_one_of_them_still_runs(self):
        counting = Counting(hold=0.001)
        settings = Settings(model_max_in_flight=2)
        models = models_of(counting, settings)
        role = Config(settings, StaticPanel()).answering()
        answers = await asyncio.gather(*(models.ask(role, []) for _ in range(6)))
        assert len(answers) == 6 and counting.now == 0


class OneUser:
    """The host, answering for any token and counting how often it was asked."""

    def __init__(self) -> None:
        self.asked = 0

    async def me(self, token: str) -> Me:
        self.asked += 1
        return Me(user_id="u1")


class TestTheTokenCacheIsBounded:
    async def test_the_oldest_validation_falls_out(self):
        # A TTL is not a bound: a flood of distinct tokens fills the map
        # faster than sixty seconds empties it.
        host = OneUser()
        auth = Authenticator(host, ttl_s=60, max_entries=2)
        for token in ("a", "b", "c"):
            await auth.authenticate(token)
        assert host.asked == 3

        await auth.authenticate("c")
        assert host.asked == 3, "the newest is still remembered"

        await auth.authenticate("a")
        assert host.asked == 4, "the oldest was dropped and had to be asked again"


class TestTheSocketsAreShared:
    @staticmethod
    def _client(seen: list[str]) -> httpx.AsyncClient:
        def handle(request: httpx.Request) -> httpx.Response:
            seen.append(str(request.url))
            return httpx.Response(200, json={"slug": "p", "totalUsd": 1.0, "wallets": []})

        return httpx.AsyncClient(transport=httpx.MockTransport(handle))

    async def test_every_call_goes_through_the_one_client(self):
        seen: list[str] = []
        client = self._client(seen)
        source = PortfolioApiSource("http://host", client)
        await source.portfolio("p", None)
        await source.portfolio("p", None)
        assert len(seen) == 2
        await client.aclose()
        with pytest.raises(RuntimeError):
            # Proof it holds the client rather than making one per call: a
            # closed client is the end of the source's reach.
            await source.portfolio("p", None)

    async def test_the_container_lets_go_of_it_on_the_way_out(self):
        wired = replace(container(), http=self._client([]))
        await wired.stop()
        assert wired.http is not None and wired.http.is_closed


class TestWhatThisInstanceCanReach:
    async def test_health_answers_from_the_process_alone(self):
        async with client_for(container()) as client:
            assert (await client.get("/health")).json() == {"ok": True}

    async def test_ready_names_where_conversations_are_being_kept(self):
        async with client_for(container()) as client:
            body = (await client.get("/ready")).json()
        assert body["ok"] is True and body["store"] == "in-process"
        assert body["panel"] == "not heard yet", "a StaticPanel decided nothing"

    async def test_a_store_that_is_configured_and_silent_is_a_503(self):
        # The failure nobody notices: everything answers, and every
        # conversation is being lost.
        dead = ConnectionPool.from_url("redis://localhost:6399/0")
        async with client_for(replace(container(), redis=dead)) as client:
            response = await client.get("/ready")
        assert response.status_code == 503
        assert response.json()["store"] == "unreachable"
