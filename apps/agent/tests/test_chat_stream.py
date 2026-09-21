import json

import pytest

from app.domain.identity import ANON_HEADER
from tests.support import Catalog, Meter, Purse, client_for, container, fake_model

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


class Asking(Model):
    async def ainvoke(self, _messages, **_kwargs):
        called, self._called = self._called, True

        class Reply:
            content = "Pick one and I will prepare it."
            tool_calls = (
                []
                if called
                else [
                    {
                        "name": "ask_the_user",
                        "args": {
                            "header": "Token",
                            "question": "Which one do we place?",
                            "options": ["USDC 12.00", "SOL 0.009"],
                        },
                        "id": "q1",
                    }
                ]
            )

        return Reply()


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
        drawn = [block for block in streamed["blocks"] if block["kind"] != "trace"]
        assert drawn == whole["blocks"], "only the receipt is the watched turn's own"
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
        assert [b["kind"] for b in done[0]["blocks"]] == ["trace", "text", "deposit"]

    async def test_reopening_the_conversation_still_shows_it(self, client):
        who = {ANON_HEADER: "anon-deposit"}
        answered = await client.post("/chat", json={"message": "put 250 USDC to work"}, headers=who)
        session = answered.json()["session_id"]
        reopened = await client.get(f"/chats/{session}", headers=who)
        assert [b["kind"] for b in reopened.json()["turns"][0]["blocks"]] == ["text", "deposit"]


class TestAQuestionOnTheWire:
    @pytest.fixture
    def wired(self, meter):
        return container(
            model=Asking(),
            limiter=meter,
            intent="earn",
            asked_to_place=True,
            catalog=Catalog(),
        )

    async def test_it_rides_beside_the_answer(self, client):
        answered = await client.post("/chat", json={"message": "put my money to work"})
        blocks = answered.json()["blocks"]
        assert [b["kind"] for b in blocks] == ["text", "choice"]
        card = blocks[1]
        assert card["header"] == "Token"
        assert card["options"] == ["USDC 12.00", "SOL 0.009"]

    async def test_the_stream_carries_it_too(self, client):
        response = await client.post("/chat/stream", json={"message": "put my money to work"})
        done = [data for name, data in parse(response.text) if name == "done"]
        assert [b["kind"] for b in done[0]["blocks"]] == ["trace", "text", "choice"]

    async def test_reopening_the_conversation_still_shows_it(self, client):
        who = {ANON_HEADER: "anon-choice"}
        answered = await client.post("/chat", json={"message": "put my money to work"}, headers=who)
        session = answered.json()["session_id"]
        reopened = await client.get(f"/chats/{session}", headers=who)
        assert [b["kind"] for b in reopened.json()["turns"][0]["blocks"]] == ["text", "choice"]


class TestTheReceipt:
    async def test_every_answered_turn_carries_one(self, client):
        events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        blocks = events[-1][1]["blocks"]
        assert blocks[0]["kind"] == "trace"
        assert [b["kind"] for b in blocks[1:]] == ["text"]

    async def test_it_holds_the_steps_that_were_streamed(self, client):
        events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        streamed = {data["id"] for name, data in events if name == "step"}
        receipt = events[-1][1]["blocks"][0]["steps"]
        assert streamed and {step["id"] for step in receipt} == streamed
        assert all(step["state"] == "done" for step in receipt)
        assert all(isinstance(step["ms"], int) for step in receipt)

    async def test_a_line_is_one_line_however_often_it_was_reported(self, client):
        events = parse((await client.post("/chat/stream", json={"message": "q"})).text)
        reported = [data["id"] for name, data in events if name == "step"]
        receipt = [step["id"] for step in events[-1][1]["blocks"][0]["steps"]]
        assert len(reported) > len(receipt) == len(set(receipt))

    async def test_reopening_the_conversation_still_shows_it(self, client):
        who = {ANON_HEADER: "anon-receipt"}
        events = parse((await client.post("/chat/stream", json={"message": "q"}, headers=who)).text)
        session = events[-1][1]["session_id"]
        reopened = await client.get(f"/chats/{session}", headers=who)
        blocks = reopened.json()["turns"][0]["blocks"]
        assert blocks[0]["kind"] == "trace" and blocks[0]["steps"]

    async def test_a_turn_where_nothing_ran_has_none(self, meter):
        purse = Purse(questions=0)
        async with client_for(
            container(model=fake_model(ANSWER), limiter=meter, allowance=purse)
        ) as walled:
            events = parse((await walled.post("/chat/stream", json={"message": "q"})).text)
        assert [b["kind"] for b in events[-1][1]["blocks"]] == ["signin"]


class Moving(Model):
    async def ainvoke(self, _messages, **_kwargs):
        called, self._called = self._called, True

        class Reply:
            content = "One signature and it is in Turbo."
            tool_calls = (
                []
                if called
                else [
                    {
                        "name": "propose_move",
                        "args": {
                            "from_pool_id": "sol:kamino:vault:PRIME",
                            "to_pool_id": "sol:kamino:vault:AAA",
                            "amount": "all",
                        },
                        "id": "m1",
                    }
                ]
            )

        return Reply()


class Holder:
    """A host with one Solana wallet, for the earn branch to read pools against."""

    async def me(self, token):
        raise AssertionError("the host was asked who is asking")

    async def portfolio(self, ref, token):
        from tests import fixtures as fx

        return fx.as_portfolio(
            fx.portfolio([fx.wallet(fx.SOL_ADDRESS, [fx.USDC_SOL], chain="SOL")])
        )


class TestAMoveOnTheWire:
    @pytest.fixture
    def wired(self, meter):
        from decimal import Decimal

        from app.domain.earn import Held, YieldPool

        shelf = Catalog()
        prime = YieldPool(
            id="sol:kamino:vault:PRIME",
            name="USDC Prime",
            protocol="kamino",
            kind="vault",
            network="sol",
            token="USDC",
            apy_net=Decimal("0.042"),
            apy_base=Decimal("0.042"),
            apy_rewards=Decimal("0"),
            apy_incentives=Decimal("0"),
            tvl_usd=Decimal("90000000"),
            url="https://kamino.com/earn/lend/PRIME",
        )
        shelf.held = (Held(pool=prime, amount=Decimal("12.001555")),)
        return container(
            model=Moving(),
            limiter=meter,
            intent="earn",
            asked_to_place=True,
            catalog=shelf,
            portfolio=Holder(),
        )

    async def test_the_card_names_both_pools_and_asks_for_all(self, client):
        answered = await client.post(
            "/chat", json={"message": "move it somewhere better", "portfolio": "p"}
        )
        card = next(b for b in answered.json()["blocks"] if b["kind"] == "deposit")
        assert card["action"] == "move"
        assert (card["fromPoolId"], card["fromPool"], card["fromApy"]) == (
            "sol:kamino:vault:PRIME",
            "USDC Prime",
            "4.20%",
        )
        assert (card["poolId"], card["pool"]) == ("sol:kamino:vault:AAA", "Steakhouse USDC")
        assert card["amount"] == "all" and card["shown"] == "12.001555"


class QuietAsking(Model):
    """Asks, and says nothing above the buttons."""

    async def ainvoke(self, _messages, **_kwargs):
        called, self._called = self._called, True

        class Reply:
            content = ""
            tool_calls = (
                []
                if called
                else [
                    {
                        "name": "ask_the_user",
                        "args": {
                            "header": "Token",
                            "question": "Which one do we place?",
                            "options": ["USDC 12.00", "SOL 0.009"],
                        },
                        "id": "q1",
                    }
                ]
            )

        return Reply()


class TestAQuestionWithNothingAboveIt:
    @pytest.fixture
    def wired(self, meter):
        return container(
            model=QuietAsking(),
            limiter=meter,
            intent="earn",
            asked_to_place=True,
            catalog=Catalog(),
        )

    async def test_the_stream_ends_with_the_card_not_an_error(self, client):
        response = await client.post("/chat/stream", json={"message": "put my money to work"})
        name, done = parse(response.text)[-1]
        assert name == "done", "a question card is an answer, not a turn that failed"
        assert [b["kind"] for b in done["blocks"]] == ["trace", "choice"], "and no empty bubble"


class TestAMoveAcrossTokensOnTheWire:
    async def test_the_card_names_the_token_it_leaves(self, meter):
        from decimal import Decimal

        from app.domain.earn import Held, YieldPool

        shelf = Catalog()
        prime = YieldPool(
            id="sol:kamino:vault:PRIME",
            name="USDC Prime",
            protocol="kamino",
            kind="vault",
            network="sol",
            token="USDT",
            apy_net=Decimal("0.042"),
            apy_base=Decimal("0.042"),
            apy_rewards=Decimal("0"),
            apy_incentives=Decimal("0"),
            tvl_usd=Decimal("90000000"),
            url="https://kamino.com/earn/lend/PRIME",
        )
        shelf.held = (Held(pool=prime, amount=Decimal("12.001555")),)
        wired = container(
            model=Moving(),
            limiter=meter,
            intent="earn",
            asked_to_place=True,
            catalog=shelf,
            portfolio=Holder(),
        )
        async with client_for(wired) as client:
            answered = await client.post("/chat", json={"message": "move it", "portfolio": "p"})
        card = next(b for b in answered.json()["blocks"] if b["kind"] == "deposit")
        assert (card["fromToken"], card["token"]) == ("USDT", "USDC")


class Paying(Model):
    async def ainvoke(self, _messages, **_kwargs):
        called, self._called = self._called, True

        class Reply:
            content = "Swapped on the way in."
            tool_calls = (
                []
                if called
                else [
                    {
                        "name": "propose_deposit",
                        "args": {
                            "pool_id": "sol:kamino:vault:AAA",
                            "amount": "0.5",
                            "token": "SOL",
                        },
                        "id": "d1",
                    }
                ]
            )

        return Reply()


class TestACoinPaidWithOnTheWire:
    async def test_the_card_names_the_coin_it_spends_by_mint(self, meter):
        from app.domain.earn import Coin

        shelf = Catalog()
        sol = Coin(symbol="SOL", mint="So11111111111111111111111111111111111111112", decimals=9)
        shelf.coins = {"SOL": sol}
        wired = container(
            model=Paying(),
            limiter=meter,
            intent="earn",
            asked_to_place=True,
            catalog=shelf,
            portfolio=Holder(),
        )
        async with client_for(wired) as client:
            answered = await client.post(
                "/chat", json={"message": "put my SOL in", "portfolio": "p"}
            )
        card = next(b for b in answered.json()["blocks"] if b["kind"] == "deposit")
        assert card["payWith"] == {"mint": sol.mint, "symbol": "SOL"}
        assert card["receiveAs"] is None
