"""The Redis backend, against a real Redis.

The in-memory tests (tests/test_store.py) cover what a conversation *means*.
This file covers what only Redis can get wrong, and specifically the one trap
this store was written around: an owner's index outliving the chats in it, so a
list shows rows that resolve to nothing.

Both halves of that fix are asserted here, because either alone is a bug that
shows up weeks later:

1. the index carries the same TTL as the chats and is pushed out on every
   write, so it never expires *before* them;
2. a read filters ids whose chat has gone and prunes them, so an index that
   somehow outlives one recovers instead of showing a dead row forever.

Skipped when there is no Redis to talk to, which is the same condition under
which the service itself falls back to the in-memory backend. To run them:

    redis-server --port 6399 --daemonize yes
    AGENT_TEST_REDIS_URL=redis://localhost:6399/0 pytest tests/test_store_redis.py

Every test works in its own randomly named keys and removes them afterwards, so
pointing this at a Redis that holds other things is safe — nothing here flushes
anything.
"""

import os
import uuid

import pytest

from app.adapters.redis.conversations import RedisConversationStore
from app.domain.conversation import CHAT_TTL_S
from app.services.sessions import SessionStore

URL = os.getenv("AGENT_TEST_REDIS_URL", "redis://localhost:6399/0")


async def _reachable() -> bool:
    try:
        from redis.asyncio import Redis
    except ImportError:  # pragma: no cover — redis is a hard dependency
        return False
    client = Redis.from_url(URL)
    try:
        await client.ping()
        return True
    except Exception:  # noqa: BLE001 — no Redis is a skip, not a failure
        return False
    finally:
        await client.aclose()


@pytest.fixture
async def redis_store():
    if not await _reachable():
        pytest.skip(f"no Redis at {URL}")
    backend = RedisConversationStore(URL)
    store = SessionStore(backend, max_messages=6, max_turns=5)
    owners: list[str] = []
    chat_ids: list[str] = []

    def track(owner: str, chat_id: str) -> tuple[str, str]:
        owners.append(owner)
        chat_ids.append(chat_id)
        return owner, chat_id

    yield store, backend, track
    raw = backend._redis
    keys = [f"agent:chat:{cid}" for cid in chat_ids] + [f"agent:owner:{o}" for o in owners]
    if keys:
        await raw.delete(*keys)
    await backend.close()


def _ids() -> tuple[str, str]:
    """A fresh owner and chat id, so two runs never share a key."""
    return f"user:test-{uuid.uuid4().hex[:12]}", uuid.uuid4().hex


class TestItRoundTrips:
    async def test_a_turn_comes_back(self, redis_store):
        store, _, track = redis_store
        owner, chat_id = track(*_ids())
        await store.append(chat_id, owner, "what changed?", "not much", [{"kind": "text"}])
        chat = await store.chat(chat_id, owner)
        assert [(t.q, t.a) for t in chat.turns] == [("what changed?", "not much")]
        assert chat.turns[0].blocks == [{"kind": "text"}]

    async def test_the_context_is_derived_from_it(self, redis_store):
        store, _, track = redis_store
        owner, chat_id = track(*_ids())
        await store.append(chat_id, owner, "hello", "hi", [])
        assert [m.content for m in await store.history(chat_id)] == ["hello", "hi"]

    async def test_it_is_listed_under_its_owner(self, redis_store):
        store, _, track = redis_store
        owner, chat_id = track(*_ids())
        await store.append(chat_id, owner, "q", "a", [])
        assert [c.id for c in await store.list(owner)] == [chat_id]

    async def test_and_not_under_anybody_else(self, redis_store):
        store, _, track = redis_store
        owner, chat_id = track(*_ids())
        await store.append(chat_id, owner, "my USDC position", "…", [])
        assert await store.chat(chat_id, "user:somebody-else") is None


class TestTheTtl:
    """Half one of the skew fix: the index never expires before its chats."""

    async def test_a_chat_carries_the_thirty_day_ttl(self, redis_store):
        store, backend, track = redis_store
        owner, chat_id = track(*_ids())
        await store.append(chat_id, owner, "q", "a", [])
        ttl = await backend._redis.ttl(f"agent:chat:{chat_id}")
        assert 0 < ttl <= CHAT_TTL_S

    async def test_the_index_carries_it_too(self, redis_store):
        """The whole trap in one assertion: an index with no TTL leaks forever,
        and an index with a shorter one strands every chat it names."""
        store, backend, track = redis_store
        owner, chat_id = track(*_ids())
        await store.append(chat_id, owner, "q", "a", [])
        ttl = await backend._redis.ttl(f"agent:owner:{owner}")
        assert 0 < ttl <= CHAT_TTL_S

    async def test_a_later_turn_pushes_the_index_deadline_back_out(self, redis_store):
        store, backend, track = redis_store
        owner, chat_id = track(*_ids())
        await store.append(chat_id, owner, "q", "a", [])
        raw = backend._redis
        # Age the index as if the last turn had been a fortnight ago.
        await raw.expire(f"agent:owner:{owner}", 60)
        assert await raw.ttl(f"agent:owner:{owner}") <= 60
        await store.append(chat_id, owner, "q2", "a2", [])
        # An index that expires 30 days after the LAST activity is the correct
        # one: somebody silent for 30 days has no chats.
        assert await raw.ttl(f"agent:owner:{owner}") > 60


class TestTheSkew:
    """Half two: a listing recovers from an index that outlived a chat."""

    async def test_an_expired_chat_is_not_listed(self, redis_store):
        store, backend, track = redis_store
        owner, kept = track(*_ids())
        gone = uuid.uuid4().hex
        track(owner, gone)
        await store.append(gone, owner, "q", "a", [])
        await store.append(kept, owner, "q", "a", [])
        # Exactly what expiry looks like to a reader: the chat key is gone and
        # the id is still sitting in the index.
        await backend._redis.delete(f"agent:chat:{gone}")
        assert [c.id for c in await store.list(owner)] == [kept]

    async def test_and_the_dead_id_is_pruned_from_the_index(self, redis_store):
        store, backend, track = redis_store
        owner, kept = track(*_ids())
        gone = uuid.uuid4().hex
        track(owner, gone)
        await store.append(gone, owner, "q", "a", [])
        await store.append(kept, owner, "q", "a", [])
        raw = backend._redis
        await raw.delete(f"agent:chat:{gone}")
        await store.list(owner)
        # Filtering alone would re-read the dead id on every listing forever.
        # Keyspace notifications are at-most-once, so this is the half that
        # cannot be delegated to Redis telling us.
        assert await raw.zscore(f"agent:owner:{owner}", gone) is None
        assert await raw.zscore(f"agent:owner:{owner}", kept) is not None

    async def test_an_index_of_nothing_but_dead_ids_reads_as_empty(self, redis_store):
        store, backend, track = redis_store
        owner, chat_id = track(*_ids())
        await store.append(chat_id, owner, "q", "a", [])
        await backend._redis.delete(f"agent:chat:{chat_id}")
        assert await store.list(owner) == []


class TestSigningIn:
    async def test_the_chats_change_hands(self, redis_store):
        store, _, track = redis_store
        anon = f"anon:test-{uuid.uuid4().hex[:12]}"
        target = f"user:test-{uuid.uuid4().hex[:12]}"
        chat_id = uuid.uuid4().hex
        track(anon, chat_id)
        track(target, chat_id)
        await store.append(chat_id, anon, "q", "a", [])
        assert await store.reassign(anon, target) == 1
        assert [c.id for c in await store.list(target)] == [chat_id]
        assert await store.list(anon) == []
        assert await store.chat(chat_id, target) is not None

    async def test_the_new_owners_index_is_given_a_ttl_as_well(self, redis_store):
        """A reassign that wrote the index without one would leak a key forever."""
        store, backend, track = redis_store
        anon = f"anon:test-{uuid.uuid4().hex[:12]}"
        target = f"user:test-{uuid.uuid4().hex[:12]}"
        chat_id = uuid.uuid4().hex
        track(anon, chat_id)
        track(target, chat_id)
        await store.append(chat_id, anon, "q", "a", [])
        await store.reassign(anon, target)
        ttl = await backend._redis.ttl(f"agent:owner:{target}")
        assert 0 < ttl <= CHAT_TTL_S

    async def test_owns_any_is_false_once_they_have_moved(self, redis_store):
        store, _, track = redis_store
        anon = f"anon:test-{uuid.uuid4().hex[:12]}"
        target = f"user:test-{uuid.uuid4().hex[:12]}"
        chat_id = uuid.uuid4().hex
        track(anon, chat_id)
        track(target, chat_id)
        await store.append(chat_id, anon, "q", "a", [])
        assert await store.owns_any(anon) is True
        await store.reassign(anon, target)
        # What makes the lazy re-key check on every authenticated turn cheap:
        # after the move there is nothing left to find.
        assert await store.owns_any(anon) is False
