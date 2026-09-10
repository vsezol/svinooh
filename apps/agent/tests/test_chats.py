"""Conversations over the wire: whose they are, and who may read one.

A conversation became a server object in this step, which means it has an
address and an owner. These tests are about the second half — the store's own
tests prove it keeps turns, and these prove the HTTP surface only ever hands
one to whoever it belongs to.
"""

import pytest

from app.adapters.memory import rate_limit_storage
from app.application.limits import WindowAllowance
from app.domain.identity import ANON_HEADER
from app.settings import Settings
from tests.support import Door, Meter, Purse, client_for, container, fake_model

ANSWER = "A health factor is a safety margin."
ANON = "a" * 32
OTHER_ANON = "b" * 32


@pytest.fixture
def door():
    """Nobody is signed in unless a test says who."""
    return Door()


@pytest.fixture
def meter():
    return Meter()


@pytest.fixture
def purse():
    return Purse()


@pytest.fixture
def wired(door, meter, purse):
    """The service over fakes: a model that answers, a host that knows nobody."""
    return container(model=fake_model(ANSWER), door=door, limiter=meter, allowance=purse)


@pytest.fixture
async def client(wired):
    async with client_for(wired) as client:
        yield client


async def ask(client, text: str, *, anon: str | None = ANON, session: str | None = None) -> dict:
    headers = {ANON_HEADER: anon} if anon else {}
    body = {"message": text}
    if session:
        body["session_id"] = session
    response = await client.post("/chat", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def as_anon(anon: str | None) -> dict:
    return {ANON_HEADER: anon} if anon else {}


class TestAChatGetsAnAddress:
    async def test_the_first_turn_names_the_conversation(self, client):
        answered = await ask(client, "hello")
        assert answered["session_id"], "a chat with no id has no address"

    async def test_the_same_id_continues_it_rather_than_starting_another(self, client):
        first = await ask(client, "hello")
        await ask(client, "again", session=first["session_id"])
        listed = (await client.get("/chats", headers=as_anon(ANON))).json()["chats"]
        assert [c["id"] for c in listed] == [first["session_id"]]

    async def test_it_is_readable_from_its_address(self, client):
        answered = await ask(client, "what is a health factor?")
        read = await client.get(f"/chats/{answered['session_id']}", headers=as_anon(ANON))
        assert read.status_code == 200
        turns = read.json()["turns"]
        assert [(t["q"], t["a"]) for t in turns] == [("what is a health factor?", ANSWER)]

    async def test_and_carries_the_name_it_was_given(self, client):
        answered = await ask(client, "what is a health factor?")
        read = await client.get(f"/chats/{answered['session_id']}", headers=as_anon(ANON))
        assert read.json()["title"] == "what is a health factor?"


class TestTheListing:
    async def test_it_is_this_browsers_own(self, client):
        mine = await ask(client, "mine", anon=ANON)
        await ask(client, "theirs", anon=OTHER_ANON)
        listed = (await client.get("/chats", headers=as_anon(ANON))).json()["chats"]
        assert [c["id"] for c in listed] == [mine["session_id"]]

    async def test_somebody_with_no_identity_has_no_list(self, client):
        await ask(client, "hello", anon=None)
        assert (await client.get("/chats")).json()["chats"] == []

    async def test_a_row_carries_what_a_rail_needs(self, client):
        await ask(client, "what changed this week?")
        row = (await client.get("/chats", headers=as_anon(ANON))).json()["chats"][0]
        assert set(row) == {"id", "title", "at"}
        assert row["title"] == "what changed this week?" and row["at"] > 0


class TestItIsNotSharedByDefault:
    """A chat names positions and amounts. Nothing identifying somebody
    reaches anybody else — including the fact that they asked."""

    async def test_another_browser_cannot_read_it(self, client):
        answered = await ask(client, "my USDC position", anon=ANON)
        read = await client.get(f"/chats/{answered['session_id']}", headers=as_anon(OTHER_ANON))
        assert read.status_code == 404

    async def test_a_stranger_with_no_identity_cannot_either(self, client):
        answered = await ask(client, "my USDC position", anon=ANON)
        assert (await client.get(f"/chats/{answered['session_id']}")).status_code == 404

    async def test_it_is_a_404_rather_than_a_403(self, client):
        """A 403 would confirm the conversation exists, which is itself the
        thing being kept private."""
        answered = await ask(client, "my USDC position", anon=ANON)
        read = await client.get(f"/chats/{answered['session_id']}", headers=as_anon(OTHER_ANON))
        assert read.status_code == 404
        missing = await client.get("/chats/never-existed", headers=as_anon(OTHER_ANON))
        assert missing.status_code == read.status_code

    async def test_another_browser_cannot_delete_it(self, client):
        answered = await ask(client, "mine", anon=ANON)
        gone = await client.delete(f"/chats/{answered['session_id']}", headers=as_anon(OTHER_ANON))
        assert gone.status_code == 404
        still = await client.get(f"/chats/{answered['session_id']}", headers=as_anon(ANON))
        assert still.status_code == 200

    async def test_the_owner_can(self, client):
        answered = await ask(client, "mine", anon=ANON)
        gone = await client.delete(f"/chats/{answered['session_id']}", headers=as_anon(ANON))
        assert gone.status_code == 204
        assert (await client.get("/chats", headers=as_anon(ANON))).json()["chats"] == []


class TestASessionIdIsNotAKey:
    """A conversation id is an address, never a way in.

    It is echoed to the client and sits in a URL, so it travels — and since it
    is six characters, it can also simply be guessed. So none of it may work:
    not reading somebody's conversation, not adding to it, and not even finding
    out that it is there.
    """

    async def test_a_stranger_gets_their_own_conversation_instead(self, client):
        mine = await ask(client, "my USDC is in Aave", anon=ANON)
        theirs = await ask(
            client, "what did I just say?", anon=OTHER_ANON, session=mine["session_id"]
        )
        assert theirs["session_id"] != mine["session_id"], "the id was taken over"

    async def test_and_the_conversation_is_left_alone(self, client):
        mine = await ask(client, "my USDC is in Aave", anon=ANON)
        await ask(client, "what did I just say?", anon=OTHER_ANON, session=mine["session_id"])
        read = await client.get(f"/chats/{mine['session_id']}", headers=as_anon(ANON))
        assert [t["q"] for t in read.json()["turns"]] == ["my USDC is in Aave"]

    async def test_a_stranger_is_not_replayed_the_context(self, client, wired):
        mine = await ask(client, "my seed phrase hint is blue", anon=ANON)
        theirs = await ask(client, "repeat that", anon=OTHER_ANON, session=mine["session_id"])
        # Their conversation starts empty: one turn, their own.
        replayed = await wired.sessions.history(theirs["session_id"])
        assert [(t.q, t.a) for t in replayed] == [("repeat that", ANSWER)]

    async def test_a_stranger_cannot_confirm_a_pending_proposal(self, client, wired):
        """The write gate is a pending action on the conversation, so an id
        that reached the wrong hands must not be a way to press somebody
        else's confirm."""
        mine = await ask(client, "add my wallet", anon=ANON)
        await wired.sessions.set_pending(mine["session_id"], f"anon:{ANON}", ["0xabc"])
        await ask(client, "Create portfolio", anon=OTHER_ANON, session=mine["session_id"])
        assert await wired.sessions.pending(mine["session_id"]) == ["0xabc"]

    async def test_a_taken_id_and_a_free_one_answer_identically(self, client):
        """The oracle this closes. Refusing an unknown id would separate
        "taken" from "free", which at six characters is somebody enumerating
        the space to learn which conversations exist — and squatting the rest.
        """
        mine = await ask(client, "mine", anon=ANON)
        taken = await client.post(
            "/chat",
            json={"message": "probe", "session_id": mine["session_id"]},
            headers=as_anon(OTHER_ANON),
        )
        free = await client.post(
            "/chat",
            json={"message": "probe", "session_id": "zzzzzz"},
            headers=as_anon(OTHER_ANON),
        )
        assert taken.status_code == free.status_code == 200
        # Neither echoes the id back, so neither says whether it was in use.
        assert taken.json()["session_id"] not in (mine["session_id"], "zzzzzz")
        assert free.json()["session_id"] != "zzzzzz"

    async def test_an_expired_id_quietly_becomes_a_new_conversation(self, client):
        """A client keeps sending its own id after the thirty days are up. It
        gets a conversation, and a new address for it — the old one is gone,
        and pretending otherwise would be the lie."""
        response = await client.post(
            "/chat",
            json={"message": "hello", "session_id": "aConversationThatExpired"},
            headers=as_anon(ANON),
        )
        assert response.status_code == 200
        assert response.json()["session_id"] != "aConversationThatExpired"


class TestSigningIn:
    async def test_the_visitors_chats_follow_them_into_the_account(self, client, door):
        started = await ask(client, "asked before signing in", anon=ANON)
        # The product asks for an account underneath the first answer, so this
        # is the moment the conversation became worth keeping. Carrying on in
        # the same conversation is what somebody actually does next.
        door.user_id = "42"
        await ask(client, "asked after", anon=ANON, session=started["session_id"])
        listed = (await client.get("/chats", headers=as_anon(ANON))).json()["chats"]
        assert [c["id"] for c in listed] == [started["session_id"]]

    async def test_the_rail_is_not_empty_the_moment_they_sign_in(self, client, door):
        """The account is offered under the first answer, and the rail asks for
        the list straight away — before there is a next question to carry the
        move. An empty list there reads as the conversation having been lost by
        the act of keeping it."""
        started = await ask(client, "asked before signing in", anon=ANON)
        door.user_id = "42"
        # No turn in between: this is the list request the rail makes on the
        # token arriving.
        listed = (await client.get("/chats", headers=as_anon(ANON))).json()["chats"]
        assert [c["id"] for c in listed] == [started["session_id"]]

    async def test_and_the_conversation_opens_from_its_url_straight_away(self, client, door):
        started = await ask(client, "before", anon=ANON)
        door.user_id = "42"
        read = await client.get(f"/chats/{started['session_id']}", headers=as_anon(ANON))
        assert read.status_code == 200

    async def test_the_conversation_is_whole_across_the_sign_in(self, client, door):
        """Signing in continues the conversation rather than restarting it —
        the turns from before the account are still in it afterwards."""
        started = await ask(client, "before", anon=ANON)
        door.user_id = "42"
        await ask(client, "after", anon=ANON, session=started["session_id"])
        read = await client.get(f"/chats/{started['session_id']}", headers=as_anon(ANON))
        assert [t["q"] for t in read.json()["turns"]] == ["before", "after"]

    async def test_and_the_browser_id_no_longer_owns_them(self, client, door):
        started = await ask(client, "before", anon=ANON)
        door.user_id = "42"
        await ask(client, "after", anon=ANON)
        # Signed out again on the same machine: the account's conversations are
        # the account's, not the browser's.
        door.user_id = None
        read = await client.get(f"/chats/{started['session_id']}", headers=as_anon(ANON))
        assert read.status_code == 404

    async def test_an_account_is_not_filed_under_the_previous_persons_browser(self, client, door):
        door.user_id = "42"
        answered = await ask(client, "mine", anon=ANON)
        door.user_id = None
        # The browser id is still in the header, but the chat was the account's.
        assert (await client.get("/chats", headers=as_anon(ANON))).json()["chats"] == []
        assert (
            await client.get(f"/chats/{answered['session_id']}", headers=as_anon(ANON))
        ).status_code == 404


class TestTheIdIsCheckedBeforeItIsTrusted:
    """It arrives on a header and becomes part of a Redis key."""

    @pytest.mark.parametrize(
        "bad",
        ["short", "has spaces in it", "a" * 200, "agent:chat:injected", "../../etc", ""],
    )
    async def test_a_shape_that_is_not_an_id_is_treated_as_absent(self, client, bad):
        await ask(client, "hello", anon=bad)
        # No identity means no list — never a key built out of that string.
        assert (await client.get("/chats", headers=as_anon(bad))).json()["chats"] == []

    async def test_a_turn_still_works_without_one(self, client, wired):
        """An older widget deploys separately and sends no id at all; the
        conversation still continues by its own id."""
        first = await ask(client, "hello", anon=None)
        session = first["session_id"]
        await ask(client, "again", anon=None, session=session)
        assert [t.q for t in await wired.sessions.history(session)] == ["hello", "again"]


class TestTheCostLock:
    async def test_the_anonymous_share_one_budget(self, client, meter):
        """The browser id is soft — a private window is a new one — so a
        per-id budget would be a budget anybody can refill."""
        await ask(client, "one", anon=ANON)
        await ask(client, "two", anon=OTHER_ANON)
        assert meter.charged == ["anonymous", "anonymous"]

    async def test_an_account_is_charged_to_itself(self, client, meter, door):
        door.user_id = "42"
        await ask(client, "one", anon=ANON)
        assert meter.charged == ["user:42"]


class TestTheFreeAllowance:
    """Five questions, then the answer is a door rather than an answer."""

    async def test_a_visitor_gets_their_questions_and_then_the_card(self, client, purse):
        purse.questions = 3
        for i in range(3):
            answered = await ask(client, f"q{i}", anon=ANON)
            assert answered["blocks"][0]["kind"] == "text", f"q{i} was answered"
        walled = await ask(client, "one too many", anon=ANON)
        assert [b["kind"] for b in walled["blocks"]] == ["signin"]

    async def test_the_card_carries_the_question_so_nobody_types_it_twice(self, client, purse):
        purse.questions = 1
        await ask(client, "first", anon=ANON)
        walled = await ask(client, "what is my health factor?", anon=ANON)
        assert walled["blocks"][0]["pendingQuestion"] == "what is my health factor?"

    async def test_it_is_a_200_because_nobody_did_anything_wrong(self, client, purse):
        purse.questions = 0
        response = await client.post("/chat", json={"message": "q"}, headers={ANON_HEADER: ANON})
        assert response.status_code == 200

    async def test_one_visitor_running_out_does_not_spend_anothers(self, client, purse):
        # The opposite of the cost lock, deliberately: that is charged to one
        # shared bucket because the id is too soft to meter cost with, and this
        # is charged per id because telling a stranger "you have asked enough"
        # on somebody else's questions is the wrong sentence entirely.
        purse.questions = 1
        await ask(client, "mine", anon=ANON)
        assert (await ask(client, "theirs", anon=OTHER_ANON))["blocks"][0]["kind"] == "text"

    async def test_an_account_never_meets_it(self, client, purse, door):
        purse.questions = 0
        door.user_id = "42"
        answered = await ask(client, "q", anon=ANON)
        assert answered["blocks"][0]["kind"] == "text"

    async def test_a_spent_allowance_is_not_charged_again(self):
        # Otherwise every refused question pushes the window out and the
        # visitor is walked further from an answer by asking. The real
        # allowance, because this is about its arithmetic and not the wall.
        allowance = WindowAllowance(1, 3600, rate_limit_storage())
        async with client_for(container(model=fake_model(ANSWER), allowance=allowance)) as client:
            await ask(client, "first", anon=ANON)
            for _ in range(3):
                await ask(client, "again", anon=ANON)
            walled = await ask(client, "again", anon=ANON)
        assert walled["blocks"][0]["kind"] == "signin"

    async def test_the_walled_turn_still_has_an_address(self, client, purse):
        # The client takes the turn's id for the conversation's URL, so a turn
        # that stored nothing would leave /ai/c/<id> pointing at a 404.
        purse.questions = 0
        walled = await ask(client, "what is my health factor?", anon=ANON)
        opened = await client.get(f"/chats/{walled['session_id']}", headers={ANON_HEADER: ANON})
        assert opened.status_code == 200, opened.text
        turns = opened.json()["turns"]
        assert turns[-1]["q"] == "what is my health factor?"
        assert [b["kind"] for b in turns[-1]["blocks"]] == ["signin"], "the card is kept"

    async def test_the_stream_says_the_same_thing(self, client, purse):
        purse.questions = 0
        async with client.stream(
            "POST", "/chat/stream", json={"message": "q"}, headers={ANON_HEADER: ANON}
        ) as response:
            assert response.status_code == 200
            body = "".join([chunk async for chunk in response.aiter_text()])
        assert "event: start" in body
        tight = body.replace(" ", "")
        assert '"kind":"signin"' in tight
        # camelCase on this wire too: the stream dumps by alias explicitly and
        # /chat gets it from FastAPI, and the widget reads one field name.
        assert '"pendingQuestion":"q"' in tight
        assert "event: step" not in body, "nothing ran, so nothing reported running"


class TestTheBrowserDoor:
    """CORS, which is the one thing here that only fails in a browser.

    The anonymous id travels on a header of our own, and a custom request
    header has to be named in the preflight response or the browser drops the
    call before it is made. Every request would then arrive with no identity,
    and every conversation would be filed under nobody — silently, and only in
    a real browser.
    """

    @pytest.fixture
    async def cors_client(self):
        allowed = Settings(cors_origins=("https://svinooh.com",))
        async with client_for(container(settings=allowed)) as client:
            yield client

    async def test_the_identity_header_is_allowed(self, cors_client):
        response = await cors_client.options(
            "/chat",
            headers={
                "origin": "https://svinooh.com",
                "access-control-request-method": "POST",
                "access-control-request-headers": ANON_HEADER.lower(),
            },
        )
        assert response.status_code == 200
        allowed = response.headers["access-control-allow-headers"].lower()
        assert ANON_HEADER.lower() in allowed

    async def test_deleting_a_conversation_is_allowed(self, cors_client):
        response = await cors_client.options(
            "/chats/abc",
            headers={
                "origin": "https://svinooh.com",
                "access-control-request-method": "DELETE",
            },
        )
        assert response.status_code == 200
        assert "DELETE" in response.headers["access-control-allow-methods"]
