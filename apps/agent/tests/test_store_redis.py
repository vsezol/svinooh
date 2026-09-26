import os
import uuid

import pytest

from app.adapters.redis import client
from app.adapters.redis.conversations import RedisConversationStore
from app.application.sessions import SessionStore
from app.domain.conversation import CHAT_TTL_S

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
    pool = client.pool(URL)
    backend = RedisConversationStore(pool)
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
    await pool.disconnect()


def _ids() -> tuple[str, str]:
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
        assert [(t.q, t.a) for t in await store.history(chat_id)] == [("hello", "hi")]

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
    async def test_a_chat_carries_the_thirty_day_ttl(self, redis_store):
        store, backend, track = redis_store
        owner, chat_id = track(*_ids())
        await store.append(chat_id, owner, "q", "a", [])
        ttl = await backend._redis.ttl(f"agent:chat:{chat_id}")
        assert 0 < ttl <= CHAT_TTL_S

    async def test_the_index_carries_it_too(self, redis_store):
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
        await raw.expire(f"agent:owner:{owner}", 60)
        assert await raw.ttl(f"agent:owner:{owner}") <= 60
        await store.append(chat_id, owner, "q2", "a2", [])
        assert await raw.ttl(f"agent:owner:{owner}") > 60


class TestTheSkew:
    async def test_an_expired_chat_is_not_listed(self, redis_store):
        store, backend, track = redis_store
        owner, kept = track(*_ids())
        gone = uuid.uuid4().hex
        track(owner, gone)
        await store.append(gone, owner, "q", "a", [])
        await store.append(kept, owner, "q", "a", [])
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
        assert await store.owns_any(anon) is False


async def test_lpdown_keeps_the_positions_it_opened_per_portfolio():
    if not await _reachable():
        pytest.skip(f"no Redis at {URL}")
    from app.adapters.redis.strategies import RedisStrategies

    pool = client.pool(URL)
    strategies = RedisStrategies(pool)
    slug = f"pf-{uuid.uuid4().hex[:8]}"
    try:
        assert await strategies.lpdown(slug) == frozenset()
        await strategies.adopt(slug, "POSITION_A")
        await strategies.adopt(slug, "POSITION_B")
        assert await strategies.lpdown(slug) == frozenset({"POSITION_A", "POSITION_B"})
        assert await strategies.lpdown(f"{slug}-other") == frozenset()
        await strategies.drop(slug, "POSITION_A")
        assert await strategies.lpdown(slug) == frozenset({"POSITION_B"})
    finally:
        await strategies.drop(slug, "POSITION_B")
        await pool.disconnect()
