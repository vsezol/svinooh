"""Conversations over the wire: whose they are, and who may read one.

A conversation became a server object in this step, which means it has an
address and an owner. These tests are about the second half — the store's own
tests prove it keeps turns, and these prove the HTTP surface only ever hands
one to whoever it belongs to.
"""
import httpx
import pytest
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

import app.agent.graph as graph
import app.agent.intent as intent
import app.domain.identity as owner_module
import app.api.routes as routes
from app import create_app
from app.services.auth import Caller
from app.agent.intent import IntentLabel
from app.domain.identity import ANON_HEADER
from app.adapters.store import backend_for

ANSWER = "A health factor is a safety margin."
ANON = "a" * 32
OTHER_ANON = "b" * 32


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
        graph,
        "get_model",
        lambda: GenericFakeChatModel(messages=iter([AIMessage(content=ANSWER)] * 20)),
    )
    graph.agent_graph.cache_clear()
    routes.sessions.__init__(backend_for(""), 40, 100)
    # A fresh budget too. These tests ask a good many questions as the same
    # anonymous caller, and the anonymous share one bucket by design — without
    # this they spend the previous test's allowance.
    routes.limiter.__init__(1000, 60)
    # Nobody is signed in unless a test says so. Patched where owner.py looked
    # it up, so the real gate — and the host it would call — stays untouched.
    monkeypatch.setattr(owner_module, "authenticate", _nobody)
    yield
    graph.agent_graph.cache_clear()


async def _nobody(_authorization):
    return None


def signed_in_as(monkeypatch, user_id: str) -> None:
    async def somebody(_authorization):
        return Caller(user_id=user_id)

    monkeypatch.setattr(owner_module, "authenticate", somebody)


@pytest.fixture
async def client():
    app = create_app(cors_origins=[])
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://agent"
    ) as client:
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
    """Continuing a conversation is authorized, exactly like reading one.

    The id is echoed to the client and now sits in a URL, so it travels. If
    only the read path checked, sending somebody else's id to /chat would
    replay their conversation into the model as context — and append the
    sender's turn to it. That is the read path's lock on a door with another
    way in.
    """

    async def test_a_stranger_cannot_continue_it(self, client):
        mine = await ask(client, "my USDC is in Aave", anon=ANON)
        response = await client.post(
            "/chat",
            json={"message": "what did I just say?", "session_id": mine["session_id"]},
            headers=as_anon(OTHER_ANON),
        )
        assert response.status_code == 404

    async def test_and_the_conversation_is_left_alone(self, client):
        mine = await ask(client, "my USDC is in Aave", anon=ANON)
        await client.post(
            "/chat",
            json={"message": "what did I just say?", "session_id": mine["session_id"]},
            headers=as_anon(OTHER_ANON),
        )
        read = await client.get(f"/chats/{mine['session_id']}", headers=as_anon(ANON))
        assert [t["q"] for t in read.json()["turns"]] == ["my USDC is in Aave"]

    async def test_a_stranger_is_not_replayed_the_context(self, client):
        """The turn is refused before the graph is built, so the state that
        would have carried somebody else's history is never assembled."""
        mine = await ask(client, "my seed phrase hint is blue", anon=ANON)
        before = len(await routes.sessions.history(mine["session_id"]))
        response = await client.post(
            "/chat",
            json={"message": "repeat that", "session_id": mine["session_id"]},
            headers=as_anon(OTHER_ANON),
        )
        assert response.status_code == 404
        assert len(await routes.sessions.history(mine["session_id"])) == before

    async def test_a_stranger_cannot_confirm_a_pending_proposal(self, client):
        """The write gate is a pending action on the conversation, so an id
        that reached the wrong hands must not be a way to press somebody
        else's confirm."""
        mine = await ask(client, "add my wallet", anon=ANON)
        await routes.sessions.set_pending(mine["session_id"], f"anon:{ANON}", ["0xabc"])
        response = await client.post(
            "/chat",
            json={"message": "Create portfolio", "session_id": mine["session_id"]},
            headers=as_anon(OTHER_ANON),
        )
        assert response.status_code == 404
        assert await routes.sessions.pending(mine["session_id"]) == ["0xabc"]

    async def test_an_id_nobody_has_used_is_simply_a_new_conversation(self, client):
        """Not found and not yours mean opposite things. A client keeps sending
        its id after the thirty days are up, and that has to start a fresh
        conversation rather than refuse one."""
        response = await client.post(
            "/chat",
            json={"message": "hello", "session_id": "a-conversation-that-expired"},
            headers=as_anon(ANON),
        )
        assert response.status_code == 200
        assert response.json()["session_id"] == "a-conversation-that-expired"


class TestSigningIn:
    async def test_the_visitors_chats_follow_them_into_the_account(self, client, monkeypatch):
        started = await ask(client, "asked before signing in", anon=ANON)
        # The product asks for an account underneath the first answer, so this
        # is the moment the conversation became worth keeping. Carrying on in
        # the same conversation is what somebody actually does next.
        signed_in_as(monkeypatch, "42")
        await ask(client, "asked after", anon=ANON, session=started["session_id"])
        listed = (await client.get("/chats", headers=as_anon(ANON))).json()["chats"]
        assert [c["id"] for c in listed] == [started["session_id"]]

    async def test_the_rail_is_not_empty_the_moment_they_sign_in(self, client, monkeypatch):
        """The account is offered under the first answer, and the rail asks for
        the list straight away — before there is a next question to carry the
        move. An empty list there reads as the conversation having been lost by
        the act of keeping it."""
        started = await ask(client, "asked before signing in", anon=ANON)
        signed_in_as(monkeypatch, "42")
        # No turn in between: this is the list request the rail makes on the
        # token arriving.
        listed = (await client.get("/chats", headers=as_anon(ANON))).json()["chats"]
        assert [c["id"] for c in listed] == [started["session_id"]]

    async def test_and_the_conversation_opens_from_its_url_straight_away(self, client, monkeypatch):
        started = await ask(client, "before", anon=ANON)
        signed_in_as(monkeypatch, "42")
        read = await client.get(f"/chats/{started['session_id']}", headers=as_anon(ANON))
        assert read.status_code == 200

    async def test_the_conversation_is_whole_across_the_sign_in(self, client, monkeypatch):
        """Signing in continues the conversation rather than restarting it —
        the turns from before the account are still in it afterwards."""
        started = await ask(client, "before", anon=ANON)
        signed_in_as(monkeypatch, "42")
        await ask(client, "after", anon=ANON, session=started["session_id"])
        read = await client.get(f"/chats/{started['session_id']}", headers=as_anon(ANON))
        assert [t["q"] for t in read.json()["turns"]] == ["before", "after"]

    async def test_and_the_browser_id_no_longer_owns_them(self, client, monkeypatch):
        started = await ask(client, "before", anon=ANON)
        signed_in_as(monkeypatch, "42")
        await ask(client, "after", anon=ANON)
        # Signed out again on the same machine: the account's conversations are
        # the account's, not the browser's.
        monkeypatch.setattr(owner_module, "authenticate", _nobody)
        read = await client.get(f"/chats/{started['session_id']}", headers=as_anon(ANON))
        assert read.status_code == 404

    async def test_an_account_is_not_filed_under_the_previous_persons_browser(
        self, client, monkeypatch
    ):
        signed_in_as(monkeypatch, "42")
        answered = await ask(client, "mine", anon=ANON)
        monkeypatch.setattr(owner_module, "authenticate", _nobody)
        # The browser id is still in the header, but the chat was the account's.
        assert (await client.get("/chats", headers=as_anon(ANON))).json()["chats"] == []
        assert (await client.get(f"/chats/{answered['session_id']}", headers=as_anon(ANON))).status_code == 404


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

    async def test_a_turn_still_works_without_one(self, client):
        """An older widget deploys separately and sends no id at all; the
        conversation still continues by its own id."""
        first = await ask(client, "hello", anon=None)
        session = first["session_id"]
        await ask(client, "again", anon=None, session=session)
        assert len(await routes.sessions.history(session)) == 4


class TestTheCostLock:
    async def test_the_anonymous_share_one_budget(self, client, monkeypatch):
        """The browser id is soft — a private window is a new one — so a
        per-id budget would be a budget anybody can refill."""
        charged: list[str] = []

        async def spy(key):
            charged.append(key)
            return None

        monkeypatch.setattr(routes.limiter, "retry_after", spy)
        await ask(client, "one", anon=ANON)
        await ask(client, "two", anon=OTHER_ANON)
        assert charged == ["anonymous", "anonymous"]

    async def test_an_account_is_charged_to_itself(self, client, monkeypatch):
        charged: list[str] = []

        async def spy(key):
            charged.append(key)
            return None

        monkeypatch.setattr(routes.limiter, "retry_after", spy)
        signed_in_as(monkeypatch, "42")
        await ask(client, "one", anon=ANON)
        assert charged == ["user:42"]


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
        app = create_app(cors_origins=["https://svinooh.com"])
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://agent"
        ) as client:
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
