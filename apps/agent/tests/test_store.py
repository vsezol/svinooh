"""The conversation store: one representation, an owner, and an expiry.

These run against the in-memory backend, which is the one local development
uses — so they are the same code path a developer without a Redis exercises.
The Redis backend has its own file (tests/test_store_redis.py), because the
half of this that can actually go wrong in production — an index outliving what
it points at — is a property of Redis keys rather than of a dict.
"""

import logging
import time

import pytest

from app.adapters.memory import MemoryConversationStore
from app.composition import conversation_store, rate_limiter
from app.domain.conversation import CHAT_TTL_S, title_of
from app.domain.ids import new_chat_id
from app.services.sessions import SessionStore


@pytest.fixture
def store():
    # 6 messages of context (three turns), 5 turns kept in the transcript.
    return SessionStore(MemoryConversationStore(), max_messages=6, max_turns=5)


class TestOneRepresentation:
    async def test_the_context_is_derived_from_the_stored_turns(self, store):
        await store.append("c1", "user:1", "what changed?", "not much", [])
        messages = await store.history("c1")
        assert [m.content for m in messages] == ["what changed?", "not much"]

    async def test_a_conversation_reads_back_whole(self, store):
        await store.append("c1", "user:1", "first", "a1", [{"kind": "text", "text": "a1"}])
        await store.append("c1", "user:1", "second", "a2", [{"kind": "text", "text": "a2"}])
        chat = await store.chat("c1", "user:1")
        assert [(t.q, t.a) for t in chat.turns] == [("first", "a1"), ("second", "a2")]
        # The blocks are stored, not rebuilt from the text: reopening shows
        # what was on screen rather than a reconstruction of it.
        assert chat.turns[0].blocks == [{"kind": "text", "text": "a1"}]

    async def test_the_model_sees_less_than_the_reader_does(self, store):
        for n in range(5):
            await store.append("c1", "user:1", f"q{n}", f"a{n}", [])
        # Three turns of context, out of five kept.
        assert [m.content for m in await store.history("c1")] == [
            "q2",
            "a2",
            "q3",
            "a3",
            "q4",
            "a4",
        ]
        assert len((await store.chat("c1", "user:1")).turns) == 5

    async def test_a_conversation_stops_growing_forever(self, store):
        for n in range(9):
            await store.append("c1", "user:1", f"q{n}", f"a{n}", [])
        turns = (await store.chat("c1", "user:1")).turns
        assert [t.q for t in turns] == ["q4", "q5", "q6", "q7", "q8"]

    async def test_a_title_is_the_first_thing_asked(self, store):
        await store.append("c1", "user:1", "what is my health factor?", "fine", [])
        await store.append("c1", "user:1", "and my LTV?", "also fine", [])
        assert (await store.chat("c1", "user:1")).title == "what is my health factor?"

    def test_a_long_question_is_cut_rather_than_stored_whole_as_a_name(self):
        assert title_of("x" * 200).endswith("…")
        assert len(title_of("x" * 200)) == 60
        assert title_of("   ") == "New chat"


class TestTheListing:
    async def test_newest_first(self, store):
        for chat_id in ("a", "b", "c"):
            await store.append(chat_id, "user:1", f"q{chat_id}", "a", [])
        assert [c.id for c in await store.list("user:1")] == ["c", "b", "a"]

    async def test_a_conversation_spoken_to_again_moves_to_the_top(self, store):
        for chat_id in ("a", "b", "c"):
            await store.append(chat_id, "user:1", "q", "a", [])
        # The scores are epoch milliseconds and a turn here costs microseconds,
        # so without this the "later" turn lands in the same millisecond as the
        # others and there is nothing for the ordering to be about.
        time.sleep(0.002)
        await store.append("a", "user:1", "again", "a", [])
        assert [c.id for c in await store.list("user:1")][0] == "a"

    async def test_one_owner_never_sees_another(self, store):
        await store.append("mine", "user:1", "q", "a", [])
        await store.append("theirs", "user:2", "q", "a", [])
        assert [c.id for c in await store.list("user:1")] == ["mine"]
        assert [c.id for c in await store.list("user:2")] == ["theirs"]


class TestItBelongsToSomebody:
    async def test_a_stranger_gets_nothing_rather_than_a_refusal(self, store):
        await store.append("c1", "user:1", "my USDC position", "…", [])
        assert await store.chat("c1", "user:2") is None

    async def test_and_cannot_delete_it_either(self, store):
        await store.append("c1", "user:1", "q", "a", [])
        assert await store.delete("c1", "user:2") is False
        assert await store.chat("c1", "user:1") is not None

    async def test_the_owner_can(self, store):
        await store.append("c1", "user:1", "q", "a", [])
        assert await store.delete("c1", "user:1") is True
        assert await store.chat("c1", "user:1") is None


class TestThePendingProposal:
    async def test_it_survives_between_turns(self, store):
        await store.set_pending("c1", "user:1", ["0xabc"])
        assert await store.pending("c1") == ["0xabc"]

    async def test_and_a_later_turn_does_not_drop_it(self, store):
        await store.set_pending("c1", "user:1", ["0xabc"])
        await store.append("c1", "user:1", "yes, create it", "done", [])
        assert await store.pending("c1") == ["0xabc"]

    async def test_clearing_it_leaves_the_conversation(self, store):
        await store.append("c1", "user:1", "q", "a", [])
        await store.set_pending("c1", "user:1", ["0xabc"])
        await store.clear_pending("c1")
        assert await store.pending("c1") is None
        assert len((await store.chat("c1", "user:1")).turns) == 1


class TestThePortfolioAConversationMade:
    """For a visitor, the conversation is the only record that they have one."""

    async def test_it_survives_between_turns(self, store):
        await store.set_portfolio("c1", "anon:deadbeef", "pf-1")
        assert (await store.resume("c1", "anon:deadbeef")).portfolio == "pf-1"

    async def test_a_later_turn_does_not_drop_it(self, store):
        await store.set_portfolio("c1", "anon:deadbeef", "pf-1")
        await store.append("c1", "anon:deadbeef", "how much is it worth", "a", [])
        assert (await store.resume("c1", "anon:deadbeef")).portfolio == "pf-1"

    async def test_a_conversation_that_made_nothing_remembers_nothing(self, store):
        await store.append("c1", "anon:deadbeef", "q", "a", [])
        assert (await store.resume("c1", "anon:deadbeef")).portfolio is None


class TestSigningIn:
    async def test_an_anonymous_visitors_chats_become_theirs(self, store):
        await store.append("c1", "anon:deadbeef", "q1", "a", [])
        await store.append("c2", "anon:deadbeef", "q2", "a", [])
        moved = await store.reassign("anon:deadbeef", "user:7")
        assert moved == 2
        assert [c.id for c in await store.list("user:7")] == ["c2", "c1"]
        assert await store.list("anon:deadbeef") == []

    async def test_the_conversation_itself_changes_hands(self, store):
        await store.append("c1", "anon:deadbeef", "q", "a", [])
        await store.reassign("anon:deadbeef", "user:7")
        assert await store.chat("c1", "user:7") is not None
        assert await store.chat("c1", "anon:deadbeef") is None

    async def test_moving_to_the_same_owner_is_not_work(self, store):
        await store.append("c1", "user:7", "q", "a", [])
        assert await store.reassign("user:7", "user:7") == 0

    async def test_nothing_to_move_is_not_an_error(self, store):
        assert await store.reassign("anon:nobody", "user:7") == 0

    async def test_owning_any_is_what_makes_the_check_cheap(self, store):
        assert await store.owns_any("anon:deadbeef") is False
        await store.append("c1", "anon:deadbeef", "q", "a", [])
        assert await store.owns_any("anon:deadbeef") is True


class TestExpiry:
    """A chat disappearing when its key expires is the intended behaviour.

    What is not intended is the index outliving it, which is what these are
    actually about — see the module docstring in app/store.py.
    """

    async def test_a_conversation_is_kept_for_thirty_days(self):
        assert CHAT_TTL_S == 30 * 24 * 60 * 60

    async def test_an_expired_conversation_is_gone(self, store):
        await store.append("c1", "user:1", "q", "a", [])
        _expire_chat(store, "c1")
        assert await store.chat("c1", "user:1") is None
        # And its context with it — a model replayed from a chat that no longer
        # exists would be answering out of a conversation nobody can see.
        assert await store.history("c1") == []

    async def test_the_index_does_not_show_what_has_expired(self, store):
        await store.append("gone", "user:1", "q", "a", [])
        await store.append("kept", "user:1", "q", "a", [])
        _expire_chat(store, "gone")
        assert [c.id for c in await store.list("user:1")] == ["kept"]

    async def test_and_the_dead_id_is_pruned_rather_than_filtered_forever(self, store):
        await store.append("gone", "user:1", "q", "a", [])
        await store.append("kept", "user:1", "q", "a", [])
        _expire_chat(store, "gone")
        await store.list("user:1")
        # The read that filtered it also removed it: the index is not still
        # carrying a row that resolves to nothing on every later listing.
        assert set(_index(store, "user:1")) == {"kept"}

    async def test_a_write_pushes_the_deadline_out_again(self, store):
        await store.append("c1", "user:1", "q", "a", [])
        first = _deadline(store, "c1")
        time.sleep(0.01)
        await store.append("c1", "user:1", "q2", "a2", [])
        assert _deadline(store, "c1") > first

    async def test_the_index_deadline_moves_with_it(self, store):
        """An index that expired first would strand every conversation in it."""
        await store.append("c1", "user:1", "q", "a", [])
        first = _index_deadline(store, "user:1")
        time.sleep(0.01)
        await store.append("c1", "user:1", "q2", "a2", [])
        assert _index_deadline(store, "user:1") > first


class TestTheFallback:
    def test_no_redis_url_is_the_in_memory_backend(self):
        assert isinstance(conversation_store(""), MemoryConversationStore)

    def test_and_it_says_so_loudly_enough_to_be_heard(self, caplog):
        """The fallback is silent by nature — everything still answers — so the
        only thing standing between a production deploy with no REDIS_URL and
        nobody noticing is this line.

        WARNING and not INFO, and that is the whole test. These factories run
        while app/api/routes.py is being imported, which is before create_app()
        configures logging; until it has, logging's last-resort handler prints
        WARNING and above and drops everything below. At info level the notice
        that the durable store is not durable appears nowhere at all — which is
        exactly what happened on the first deploy of it.
        """
        with caplog.at_level(logging.WARNING, logger="svinooh-ai"):
            conversation_store("")
            rate_limiter("", 20, 300)
        said = [r.message for r in caplog.records if r.levelno >= logging.WARNING]
        assert any("REDIS_URL" in m for m in said), "the fallback went quiet"
        assert sum("REDIS_URL" in m for m in said) == 2, "both halves say so"


# ── reaching into the dev backend, so expiry can be tested without waiting ──


def _backend(store: SessionStore) -> MemoryConversationStore:
    return store._store


def _expire_chat(store: SessionStore, chat_id: str) -> None:
    """Age one chat out while leaving its id in the index — the skew, exactly."""
    backend = _backend(store)
    _, chat = backend._chats[chat_id]
    backend._chats[chat_id] = (time.time() - 1, chat)


def _deadline(store: SessionStore, chat_id: str) -> float:
    return _backend(store)._chats[chat_id][0]


def _index(store: SessionStore, owner: str) -> dict:
    return _backend(store)._index[owner][1]


def _index_deadline(store: SessionStore, owner: str) -> float:
    return _backend(store)._index[owner][0]


class TestTheIdIsAnAddress:
    """Six characters, because the id's whole job is to be a URL somebody
    sees, copies and occasionally reads out. Safe to shorten because it is not
    a secret: reading a conversation checks who is asking, so a guessed id
    answers exactly like an invented one."""

    def test_it_is_short_enough_to_be_a_name(self):
        assert len(new_chat_id()) == 6

    def test_it_leaves_out_the_characters_people_confuse(self):
        """Six characters is short enough that somebody will read one aloud."""
        seen = {c for _ in range(2000) for c in new_chat_id()}
        assert not (seen & set("0O1lI")), "a confusable character got in"

    def test_it_is_not_a_counter(self):
        """Predictable ids would make one conversation's address say something
        about the next one's."""
        assert len({new_chat_id() for _ in range(1000)}) == 1000

    async def test_a_taken_id_is_not_handed_out_again(self, store, monkeypatch):
        """The arithmetic only has to make this rare; the store still asks."""
        await store.append("TAKEN", "user:1", "q", "a", [])
        handed = iter(["TAKEN", "TAKEN", "FRESH1"])
        monkeypatch.setattr("app.services.sessions.new_chat_id", lambda: next(handed))
        assert await store.new_id() == "FRESH1"

    async def test_a_fresh_id_is_used_as_it_is(self, store, monkeypatch):
        monkeypatch.setattr("app.services.sessions.new_chat_id", lambda: "FRESH1")
        assert await store.new_id() == "FRESH1"
