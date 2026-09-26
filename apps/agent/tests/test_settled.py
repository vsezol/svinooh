from typing import ClassVar

import pytest

from app.agent.intent import IntentLabel
from app.domain.conversation import Turn
from app.domain.earn import Settled
from app.domain.identity import ANON_HEADER
from app.ports import Ask
from tests.support import agent, client_for, container, fake_model

LANDED = {
    "amount": "12.0014",
    "token": "USDC",
    "pool": "Elemental USDC Turbo",
    "status": "landed",
    "signature": "3P6KVhm1tBoK4pukKwY4VnkSscdtE4QJYRsb8mbntCsH8S",
}

FAILED = {**LANDED, "status": "failed", "error": "insufficient funds"}

REFUSED = {
    "amount": "12.0014",
    "token": "USDC",
    "pool": "Elemental USDC Turbo",
    "status": "refused",
    "error": "this deposit needs 0.00532384 SOL for rent and this wallet has 0.001480221 SOL",
}

SETTLED = Settled(**LANDED)


def turn(q: str, a: str) -> Turn:
    return Turn(q=q, a=a, at=0)


class Seen:
    """Keeps the system message the turn was answered with."""

    def __init__(self, said: str = "done"):
        self.system = ""
        self._said = said

    def bind_tools(self, _tools):
        return self

    async def ainvoke(self, messages, **_kwargs):
        self.system = str(messages[0].content)

        class Reply:
            content = self._said
            tool_calls: ClassVar[list] = []

        return Reply()

    async def astream(self, messages, **kwargs):
        yield await self.ainvoke(messages, **kwargs)


@pytest.fixture
def model():
    return Seen()


@pytest.fixture
def wired(model):
    return container(model=model, intent="earn")


@pytest.fixture
async def client(wired):
    async with client_for(wired) as client:
        yield client


class TestADepositThatCameBack:
    async def test_the_answer_is_written_from_what_the_network_did(self, client, model):
        answered = await client.post("/chat", json={"message": "signed", "settled": LANDED})
        assert answered.status_code == 200
        assert "Elemental USDC Turbo" in model.system
        assert "12.0014 USDC" in model.system
        assert "the money is where it was sent" in model.system

    async def test_a_rejection_is_carried_with_its_reason(self, client, model):
        await client.post("/chat", json={"message": "signed", "settled": FAILED})
        assert "nothing left the wallet" in model.system
        assert "insufficient funds" in model.system

    async def test_it_is_not_treated_as_a_question_about_where_to_earn(self, client, model):
        await client.post("/chat", json={"message": "signed", "settled": LANDED})
        assert "Recommend only" not in model.system, "the earn branch answered a settled deposit"

    async def test_the_turn_is_remembered_without_a_question_nobody_asked(self, client, wired):
        who = {ANON_HEADER: "anon-settled"}
        answered = await client.post(
            "/chat", json={"message": "signed", "settled": LANDED}, headers=who
        )
        session = answered.json()["session_id"]
        assert [turn.q for turn in await wired.sessions.history(session)] == [""]

    async def test_an_ordinary_turn_still_keeps_its_question(self, client, wired):
        who = {ANON_HEADER: "anon-asked"}
        answered = await client.post("/chat", json={"message": "where do I earn?"}, headers=who)
        session = answered.json()["session_id"]
        assert [turn.q for turn in await wired.sessions.history(session)] == ["where do I earn?"]


class TestWithoutOne:
    @pytest.fixture
    def wired(self):
        return container(model=fake_model("ordinary"), intent="general")

    async def test_a_turn_with_no_deposit_behind_it_answers_as_it_always_did(self, client):
        answered = await client.post("/chat", json={"message": "hello"})
        assert answered.json()["reply"] == "ordinary"


class Watching:
    """Remembers the text the router was actually given."""

    def __init__(self):
        self.asked: list[str] = []

    async def classify(self, question: str, history: tuple = ()) -> IntentLabel:
        self.asked.append(question)
        return IntentLabel(intent="earn", reason="stubbed", stance="asking", language="Russian")


class TestWhoseWordsDecideTheTurn:
    async def test_the_router_reads_what_they_last_typed_not_the_machine_line(self):
        watching = Watching()
        said = Seen()
        answered = agent(model=said, intents=watching)
        await answered.run(
            Ask(
                question="a deposit came back from the network",
                history=(turn("закинь мои бабки", "готовлю"),),
                settled=SETTLED,
            )
        )
        assert watching.asked == ["закинь мои бабки"]

    async def test_and_the_answer_is_asked_for_in_that_language(self):
        said = Seen()
        answered = agent(model=said, intents=Watching())
        await answered.run(
            Ask(
                question="a deposit came back from the network",
                history=(turn("закинь мои бабки", "готовлю"),),
                settled=SETTLED,
            )
        )
        assert "Russian" in said.system

    async def test_an_ordinary_turn_is_still_read_as_it_was_typed(self):
        watching = Watching()
        await agent(model=Seen(), intents=watching).run(
            Ask(question="where do I earn?", history=(turn("привет", "hi"),))
        )
        assert watching.asked == ["where do I earn?"]


class TestADepositThatNeverReachedTheWallet:
    async def test_nothing_was_signed_and_the_reason_is_carried(self):
        said = Seen()
        answered = agent(model=said, intents=Watching())
        await answered.run(
            Ask(
                question="a deposit came back from the network",
                history=(turn("закинь мои бабки", "готовлю"),),
                settled=Settled(**REFUSED),
            )
        )
        assert "never opened and nothing was signed" in said.system
        assert "0.00532384 SOL" in said.system

    async def test_it_needs_no_signature_to_be_told(self):
        assert Settled(**REFUSED).signature is None


class TestAWithdrawalOrAMoveThatCameBack:
    async def test_a_withdrawal_is_told_as_one(self, client, model):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {**LANDED, "action": "withdraw", "amount": "all", "pool": "USDC Prime"},
            },
        )
        assert "a withdrawal out of USDC Prime, back to their wallet" in model.system
        assert "all of it" in model.system

    async def test_a_move_names_both_ends(self, client, model):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {**LANDED, "action": "move", "from_pool": "USDC Prime"},
            },
        )
        assert "a move out of USDC Prime and into Elemental USDC Turbo" in model.system


class TestHalfAMove:
    async def test_a_move_that_stopped_halfway_says_where_the_money_is(self, client, model):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {
                    **LANDED,
                    "action": "move",
                    "from_pool": "USDC Prime",
                    "halfway": True,
                    "error": "User rejected the request.",
                },
            },
        )
        assert "only the first part went through" in model.system
        assert "is in their wallet now" in model.system

    async def test_stopping_between_steps_says_what_the_money_waits_in(self, client, model):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {
                    **LANDED,
                    "action": "move",
                    "from_pool": "Keel Flagship USDS",
                    "token": "USDS",
                    "into": "USDC",
                    "halfway": True,
                    "holding": "USDS",
                    "error": "User rejected the request.",
                },
            },
        )
        assert "is in their wallet now as USDS" in model.system
        assert "it did not reach Elemental USDC Turbo" in model.system

    async def test_a_withdrawal_that_stopped_before_its_swap_says_it_was_not_swapped(
        self, client, model
    ):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {
                    **LANDED,
                    "action": "withdraw",
                    "pool": "Allez USX",
                    "token": "USX",
                    "into": "SOL",
                    "halfway": True,
                    "holding": "USX",
                },
            },
        )
        assert "out of Allez USX and in their wallet as USX" in model.system
        assert "it was not swapped to SOL" in model.system


class TestWhatASwapBecame:
    async def test_a_withdrawal_taken_out_as_another_coin_says_what_it_became(self, client, model):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {
                    **LANDED,
                    "action": "withdraw",
                    "pool": "Allez SOL",
                    "amount": "0.1",
                    "token": "SOL",
                    "into": "USDC",
                },
            },
        )
        assert (
            "a withdrawal out of Allez SOL, back to their wallet, swapped from SOL to USDC"
            in model.system
        )
        assert "0.1 SOL" in model.system

    async def test_a_deposit_paid_with_another_coin_says_so(self, client, model):
        await client.post(
            "/chat",
            json={"message": "signed", "settled": {**LANDED, "token": "SOL", "into": "USDC"}},
        )
        assert "a deposit into Elemental USDC Turbo, swapped from SOL to USDC" in model.system


class TestLiquidityThatCameBack:
    async def test_placed_liquidity_is_told_as_placed(self, client, model):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {**LANDED, "action": "provide", "pool": "SOL-USDC", "amount": "5"},
            },
        )
        assert "liquidity placed in SOL-USDC" in model.system

    async def test_a_rebalance_that_stopped_after_the_close_says_where_the_money_is(
        self, client, model
    ):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {
                    **LANDED,
                    "action": "rebalance",
                    "pool": "SOL-USDC",
                    "amount": "all",
                    "halfway": True,
                    "holding": "SOL and USDC",
                    "error": "User rejected the request.",
                },
            },
        )
        assert "is in their wallet now as SOL and USDC" in model.system
        assert "the new position in SOL-USDC was not opened" in model.system

    async def test_a_close_that_stopped_halfway_says_the_rest_is_still_in(self, client, model):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {**LANDED, "action": "close", "pool": "SOL-USDC", "halfway": True},
            },
        )
        assert "the rest is still in the position" in model.system


class TestASwapThatCameBack:
    SWAPPED: ClassVar[dict] = {
        **LANDED,
        "action": "swap",
        "pool": "xBTC to USDC",
        "amount": "all",
        "token": "xBTC",
        "into": "USDC",
    }

    async def test_a_swap_is_told_as_one(self, client, model):
        await client.post("/chat", json={"message": "signed", "settled": self.SWAPPED})
        assert "a swap of xBTC to USDC, in their own wallet" in model.system

    async def test_a_swap_that_stopped_halfway_says_it_did_not_become_the_coin(self, client, model):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {**self.SWAPPED, "halfway": True, "holding": "SOL"},
            },
        )
        assert "in their wallet as SOL, and it did not become USDC" in model.system


class TestHalfwayIsNotLanded:
    async def test_a_placement_that_stopped_after_its_swap_is_told_and_not_carried_on(
        self, client, model
    ):
        await client.post(
            "/chat",
            json={
                "message": "signed",
                "settled": {
                    **LANDED,
                    "action": "provide",
                    "pool": "SOL-USDC",
                    "amount": "100",
                    "halfway": True,
                    "holding": "USDC and SOL",
                    "error": "the next step could not be prepared",
                },
            },
        )
        assert "the new position in SOL-USDC was not opened" in model.system
        assert "Then look back over this conversation" not in model.system, (
            "a flow that stopped halfway was answered as one that landed"
        )
        assert "do not offer something new in the same breath" in model.system


class Saying:
    """Answers each turn's calls in order, and keeps what it was shown and given."""

    def __init__(self, *said: str):
        self._said = list(said)
        self.systems: list[str] = []
        self.tools: list[str] = []

    def bind_tools(self, tools):
        self.tools = [one.name for one in tools]
        return self

    async def ainvoke(self, messages, **_kwargs):
        self.systems.append(str(messages[0].content))
        said = self._said.pop(0) if self._said else "done"

        class Reply:
            content = said
            tool_calls: ClassVar[list] = []

        return Reply()

    async def astream(self, messages, **kwargs):
        yield await self.ainvoke(messages, **kwargs)


def came_back(settled: Settled) -> Ask:
    return Ask(
        question="a deposit came back from the network",
        history=(turn("move it all into SOL-USDC, -5% / +5%", "the first step is ready"),),
        settled=settled,
    )


class TestWhatComesAfterALanding:
    async def test_a_landed_step_is_carried_on_with_what_was_agreed(self):
        said = Saying("Your USDC is back in your wallet.")
        await agent(model=said, intents=Watching()).run(came_back(SETTLED))
        assert "prepare that next step now, the way it was agreed" in said.systems[0]
        assert "propose_liquidity" in said.tools
        assert "Recommend only" not in said.systems[0]

    async def test_one_that_failed_is_only_told(self):
        said = Saying("It did not go through.")
        await agent(model=said, intents=Watching()).run(came_back(Settled(**FAILED)))
        assert "prepare that next step now" not in said.systems[0]
        assert "Say nothing about rates, pools or amounts" in said.systems[0]
        assert said.tools == []

    async def test_a_card_it_names_but_never_prepared_is_written_again_without_it(self):
        said = Saying(
            "The withdrawal went through. Now the deposit card is ready below.",
            "The withdrawal went through: your USDC is back in your wallet.",
        )
        reply = await agent(model=said, intents=Watching()).run(came_back(SETTLED))
        assert reply.answer == "The withdrawal went through: your USDC is back in your wallet."
        assert "no card and no button is on their screen" in said.systems[-1]
        assert reply.deposits == ()

    async def test_an_answer_that_names_no_card_is_kept_as_it_is(self):
        said = Saying("Your USDC is back in your wallet.", "never asked")
        reply = await agent(model=said, intents=Watching()).run(came_back(SETTLED))
        assert reply.answer == "Your USDC is back in your wallet."
        assert len(said.systems) == 1
