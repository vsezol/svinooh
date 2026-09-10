"""The dev adapters: no Redis to run, and the same behaviour without it.

The same shape apps/api/src/cache/cache.service.ts uses, for the same reason:
local development should not require a Redis, and the fallback being
in-process is honest about what it is — one instance, gone on restart, which
is precisely what production stopped being.

Expiry is checked on read rather than by a timer: with no background task
there is nothing extra to crash, and a store nobody reads grows by at most
what its callers sent.
"""
import time

from limits.aio.storage import MemoryStorage

from ..domain.conversation import CHAT_TTL_S, Chat


class MemoryConversationStore:
    """ports.ConversationStore in a pair of dicts.

    Faithful to the Redis adapter where it counts, including the things that
    are easy to get subtly different — the whole owner index gets a fresh
    deadline on a write (it is one key in Redis, so it has to behave like one),
    and equal scores order the way ZREVRANGE orders them.
    """

    def __init__(self) -> None:
        # chat id -> (expires at, chat)
        self._chats: dict[str, tuple[float, Chat]] = {}
        # owner key -> (expires at, {chat id: updated ms})
        self._index: dict[str, tuple[float, dict[str, int]]] = {}

    def _live_chat(self, chat_id: str) -> Chat | None:
        found = self._chats.get(chat_id)
        if not found:
            return None
        if found[0] < time.time():
            del self._chats[chat_id]
            return None
        return found[1]

    def _live_index(self, owner: str) -> dict[str, int] | None:
        found = self._index.get(owner)
        if not found:
            return None
        if found[0] < time.time():
            del self._index[owner]
            return None
        return found[1]

    async def load(self, chat_id: str) -> Chat | None:
        return self._live_chat(chat_id)

    async def save(self, chat: Chat) -> None:
        expires = time.time() + CHAT_TTL_S
        self._chats[chat.id] = (expires, chat)
        entries = self._live_index(chat.owner) or {}
        entries[chat.id] = chat.updated
        self._index[chat.owner] = (expires, entries)

    async def for_owner(self, owner: str, limit: int) -> list[Chat]:
        entries = self._live_index(owner)
        if not entries:
            return []
        # (score, id) rather than score alone, because that is what ZREVRANGE
        # does with a tie: equal scores come back in reverse lexicographic
        # order. Two chats written in the same millisecond are rare, and a dev
        # adapter that orders them differently from production is the kind of
        # difference only ever found the hard way.
        newest = sorted(entries, key=lambda cid: (entries[cid], cid), reverse=True)[:limit]
        chats: list[Chat] = []
        missing: list[str] = []
        for chat_id in newest:
            chat = self._live_chat(chat_id)
            if chat is None:
                missing.append(chat_id)
            else:
                chats.append(chat)
        for chat_id in missing:
            entries.pop(chat_id, None)
        return chats

    async def delete(self, chat: Chat) -> None:
        self._chats.pop(chat.id, None)
        entries = self._live_index(chat.owner)
        if entries:
            entries.pop(chat.id, None)

    async def has_any(self, owner: str) -> bool:
        return bool(self._live_index(owner))

    async def reassign(self, source: str, target: str) -> int:
        entries = self._live_index(source)
        if not entries:
            return 0
        moved = 0
        for chat_id in list(entries):
            chat = self._live_chat(chat_id)
            if chat is None:
                continue
            chat.owner = target
            await self.save(chat)
            moved += 1
        self._index.pop(source, None)
        return moved

    async def close(self) -> None:
        return None


def rate_limit_storage() -> MemoryStorage:
    """Counters for one process — right for one process, and only that."""
    return MemoryStorage()
