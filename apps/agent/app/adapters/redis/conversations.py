"""Conversations kept in Redis — one adapter behind ports.ConversationStore.

**The key space**, all under one prefix so sharing an instance with the
portfolio cache is a neighbour rather than a collision:

    agent:chat:<id>           the conversation — turns, title, owner, pending
    agent:owner:<owner_key>   that owner's chat ids, a ZSET scored by updated

Two keys because they answer two different questions. `agent:chat:<id>` is the
record, fetched by id in one hop. `agent:owner:<key>` is a secondary index:
Redis cannot answer "every chat whose owner is X" — the only alternative is
SCAN over the whole keyspace, which walks every key on the instance (the
portfolio cache included), returns no order, and can return the same key twice.
The ZSET answers it in one ZREVRANGE and keeps the ordering as data, because
the score IS the last-turn time. Only the id and that score are duplicated
between the two keys; the title and the turns exist once.

**The TTL/index skew is the one real trap here.** When `agent:chat:<id>`
expires, its id is still sitting in the owner's ZSET, and a listing built from
the index alone shows rows that resolve to nothing. Two measures, and they
cover different failures — the second is the one that does the work:

1. The index carries the same TTL and is pushed out on every write. This does
   NOT keep stale ids out of an active owner's index: their index is refreshed
   forever while individual chats inside it expire. What it prevents is the
   opposite failure — an index expiring BEFORE its chats, which would leave a
   live conversation openable by URL but missing from the rail — and it bounds
   the leak for an owner who never comes back.
2. Reads drop ids that came back empty and ZREM them. This is what actually
   keeps the index honest, and it is why a listing is self-healing.

Keyspace notifications are deliberately not used for this: they are
at-most-once, so a missed event would leave the skew in place permanently.
"""

import json
from typing import cast

from ...domain.conversation import CHAT_TTL_S, Chat
from . import client as redis_client

_CHAT = "agent:chat:"
_OWNER = "agent:owner:"


def _parse(raw: str | bytes | None) -> Chat | None:
    if not raw:
        return None
    try:
        return Chat.from_dict(json.loads(raw))
    except (ValueError, TypeError):
        return None


class RedisConversationStore:
    """Every write is a pipeline, so the chat and its index entry get their new
    TTL together rather than in two round trips that can be interrupted
    between. Not a transaction, and it does not need to be: the read path
    already treats an index entry with no chat behind it as a miss, which is
    the same state a half-applied write would leave."""

    def __init__(self, url: str) -> None:
        self._redis = redis_client.client(url)

    async def load(self, chat_id: str) -> Chat | None:
        return _parse(await self._redis.get(f"{_CHAT}{chat_id}"))

    async def save(self, chat: Chat) -> None:
        pipe = self._redis.pipeline(transaction=False)
        pipe.set(f"{_CHAT}{chat.id}", json.dumps(chat.as_dict()), ex=CHAT_TTL_S)
        pipe.zadd(f"{_OWNER}{chat.owner}", {chat.id: chat.updated})
        # An index that expires 30 days after the last activity is the correct
        # index: somebody with no activity for 30 days has no chats.
        pipe.expire(f"{_OWNER}{chat.owner}", CHAT_TTL_S)
        await pipe.execute()

    async def for_owner(self, owner: str, limit: int) -> list[Chat]:
        index = f"{_OWNER}{owner}"
        # decode_responses is on (client.py), so these are str; the stub is wider.
        ids = cast(list[str], await self._redis.zrevrange(index, 0, limit - 1))
        if not ids:
            return []
        raws = await self._redis.mget([f"{_CHAT}{chat_id}" for chat_id in ids])
        chats: list[Chat] = []
        missing: list[str] = []
        for chat_id, raw in zip(ids, raws, strict=True):
            chat = _parse(raw)
            if chat is None:
                missing.append(chat_id)
            else:
                chats.append(chat)
        # The half of the skew fix that does the work: an id whose chat has
        # expired is dropped now, so the listing is not paying for it again.
        if missing:
            await self._redis.zrem(index, *missing)
        return chats

    async def delete(self, chat: Chat) -> None:
        pipe = self._redis.pipeline(transaction=False)
        pipe.delete(f"{_CHAT}{chat.id}")
        pipe.zrem(f"{_OWNER}{chat.owner}", chat.id)
        await pipe.execute()

    async def has_any(self, owner: str) -> bool:
        return bool(await self._redis.exists(f"{_OWNER}{owner}"))

    async def reassign(self, source: str, target: str) -> int:
        ids = cast(list[str], await self._redis.zrange(f"{_OWNER}{source}", 0, -1))
        moved = 0
        for chat_id in ids:
            chat = _parse(await self._redis.get(f"{_CHAT}{chat_id}"))
            # An id with nothing behind it is an expired chat, which is what
            # dropping the source index at the end takes care of.
            if chat is None:
                continue
            chat.owner = target
            await self.save(chat)
            moved += 1
        await self._redis.delete(f"{_OWNER}{source}")
        return moved

    async def close(self) -> None:
        await redis_client.close()
