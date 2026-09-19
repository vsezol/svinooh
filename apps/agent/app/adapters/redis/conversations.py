import json
from typing import cast

from redis.asyncio import ConnectionPool, Redis

from ...domain.conversation import CHAT_TTL_S, Chat

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
    def __init__(self, pool: ConnectionPool) -> None:
        self._redis = Redis(connection_pool=pool)

    async def load(self, chat_id: str) -> Chat | None:
        return _parse(await self._redis.get(f"{_CHAT}{chat_id}"))

    async def save(self, chat: Chat) -> None:
        pipe = self._redis.pipeline(transaction=False)
        pipe.set(f"{_CHAT}{chat.id}", json.dumps(chat.as_dict()), ex=CHAT_TTL_S)
        pipe.zadd(f"{_OWNER}{chat.owner}", {chat.id: chat.updated})
        pipe.expire(f"{_OWNER}{chat.owner}", CHAT_TTL_S)
        await pipe.execute()

    async def for_owner(self, owner: str, limit: int) -> list[Chat]:
        index = f"{_OWNER}{owner}"
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
            if chat is None:
                continue
            chat.owner = target
            await self.save(chat)
            moved += 1
        await self._redis.delete(f"{_OWNER}{source}")
        return moved
