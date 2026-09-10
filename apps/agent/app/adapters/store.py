"""Where a conversation actually lives — Redis in production, a dict in dev.

This is the storage half of `SessionStore` (app/sessions.py), which is the
seam the rest of the service speaks to. Nothing above this module knows which
backend is behind it, which is the point: the note at the top of sessions.py
has promised an external store since the first version, and swapping Postgres
in later is another class in this file rather than a rewrite upstream.

**One representation.** A conversation is stored once, as its turns. The
context replayed into the model is derived from those turns, not kept beside
them — see `SessionStore.history`. Two copies of one conversation is the split
this step exists to remove, and it is a bug class this repo has already paid
for twice.

**The key space**, all under one prefix so sharing an instance with the
portfolio cache is a neighbour rather than a collision:

    agent:chat:<id>           the conversation — turns, title, owner, pending
    agent:owner:<owner_key>   that owner's chat ids, a ZSET scored by updated

**Expiry is a feature.** A conversation lives 30 days from its last turn and
then it is gone, which is the intended behaviour rather than a limitation to
work around.

**The one real trap is TTL/index skew.** When `agent:chat:<id>` expires the id
is still sitting in its owner's ZSET, and a list built from that index alone
shows rows that resolve to nothing. Both halves are needed and both are here:

1. The index carries the same TTL and is refreshed on every write, so an index
   expires 30 days after the last activity — somebody who has not asked
   anything in 30 days has no chats, so an empty index is the correct state.
2. Reads fetch the chats the index named, drop the ids that came back empty,
   and prune those ids from the index.

Keyspace notifications are deliberately not used for this: they are
at-most-once, so a missed event leaves the skew in place forever, which is the
failure this pair of measures is for.
"""
import json
import time
from dataclasses import dataclass, field
from typing import Protocol

# Thirty days, from the last turn. The number lives here rather than in
# config.py because it is not a knob: it is the promise the product makes about
# how long a chat is kept, and changing it is a decision rather than a deploy.
CHAT_TTL_S = 30 * 24 * 60 * 60

_CHAT = "agent:chat:"
_OWNER = "agent:owner:"


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Turn:
    """One exchange, as both things it has to be.

    `a` is the answer as text — what the model is replayed on the next turn.
    `blocks` is the same answer as the reader saw it. They are one record
    rather than two stores: rebuilding blocks from the text on read would be a
    layer guessing what to draw, which is the thing the roadmap's second rule
    forbids. Today blocks is always a single text block; the tool-drawn widgets
    of steps 1 and 2 land in it without touching this file.
    """

    q: str
    a: str
    at: int
    blocks: list[dict] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {"q": self.q, "a": self.a, "at": self.at, "blocks": self.blocks}

    @staticmethod
    def from_dict(raw: dict) -> "Turn":
        blocks = raw.get("blocks")
        return Turn(
            q=str(raw.get("q") or ""),
            a=str(raw.get("a") or ""),
            at=int(raw.get("at") or 0),
            blocks=blocks if isinstance(blocks, list) else [],
        )


@dataclass
class Chat:
    """A conversation, whole. The only representation of one there is."""

    id: str
    owner: str
    title: str
    created: int
    updated: int
    turns: list[Turn] = field(default_factory=list)
    # An action proposed but not yet confirmed — today the wallet addresses of
    # a portfolio-creation proposal. Living with the conversation is what makes
    # the confirmation a SEPARATE turn: the write physically cannot happen in
    # the request that proposed it. It used to live in RAM, which meant a
    # restart between the proposal and the yes silently dropped the proposal.
    pending: list[str] | None = None

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "owner": self.owner,
            "title": self.title,
            "created": self.created,
            "updated": self.updated,
            "turns": [turn.as_dict() for turn in self.turns],
            "pending": self.pending,
        }

    @staticmethod
    def from_dict(raw: dict) -> "Chat | None":
        """Rebuild a chat, or None for anything that is not one.

        A stored value that cannot be read is treated as absent rather than as
        an error: the store is the only thing that writes here, so a shape it
        does not recognise is either a half-finished migration or somebody
        else's key, and neither is worth failing a chat turn over.
        """
        if not isinstance(raw, dict) or not raw.get("id") or not raw.get("owner"):
            return None
        turns = raw.get("turns")
        pending = raw.get("pending")
        return Chat(
            id=str(raw["id"]),
            owner=str(raw["owner"]),
            title=str(raw.get("title") or ""),
            created=int(raw.get("created") or 0),
            updated=int(raw.get("updated") or 0),
            turns=[Turn.from_dict(t) for t in turns if isinstance(t, dict)]
            if isinstance(turns, list)
            else [],
            pending=[str(a) for a in pending] if isinstance(pending, list) and pending else None,
        )


class Backend(Protocol):
    """What a conversation store needs of its storage, and nothing more.

    Narrow on purpose: a generic Redis facade would make the in-memory version
    a second Redis implementation, and this one is meant to be small enough to
    be obviously correct.
    """

    async def load(self, chat_id: str) -> Chat | None: ...

    async def save(self, chat: Chat) -> None:
        """Write the chat and its index entry, both stamped with a fresh TTL."""

    async def load_many(self, owner: str, limit: int) -> list[Chat]:
        """That owner's chats, newest first, misses pruned from the index."""

    async def delete(self, chat: Chat) -> None: ...

    async def has(self, owner: str) -> bool:
        """Whether this owner has an index at all — the cheap re-key check."""

    async def reassign(self, source: str, target: str) -> int:
        """Move every chat from one owner to another. Returns how many moved."""

    async def close(self) -> None: ...


class MemoryBackend:
    """The dev backend: no Redis to run, same behaviour including expiry.

    Expiry is checked on read rather than by a timer, the way SessionStore's
    eviction always was: with no background task there is nothing extra to
    crash, and a store nobody reads grows by at most what its callers sent.
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
        # The whole index gets the fresh deadline, not just this row — the
        # index is one key in Redis and this has to behave the same way.
        self._index[chat.owner] = (expires, entries)

    async def load_many(self, owner: str, limit: int) -> list[Chat]:
        entries = self._live_index(owner)
        if not entries:
            return []
        # (score, id) rather than score alone, because that is what ZREVRANGE
        # does with a tie: equal scores come back in reverse lexicographic
        # order. Two chats written in the same millisecond are rare, and a dev
        # backend that orders them differently from production is the kind of
        # difference that is only ever found the hard way.
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

    async def has(self, owner: str) -> bool:
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


class RedisBackend:
    """The production backend.

    Every write is a pipeline, so the chat and its index entry get their new
    TTL together rather than in two round trips that can be interrupted
    between. A pipeline is not a transaction here and does not need to be: the
    read path already treats an index entry with no chat behind it as a miss,
    which is the same state a half-applied write would leave.
    """

    def __init__(self, url: str) -> None:
        from redis.asyncio import Redis

        # decode_responses so what comes back is str — every value here is JSON
        # this module wrote. redis-py resolves with AF_UNSPEC, so Railway's
        # IPv6-only private network needs no equivalent of ioredis's family: 0.
        self._redis = Redis.from_url(url, decode_responses=True)

    async def load(self, chat_id: str) -> Chat | None:
        raw = await self._redis.get(f"{_CHAT}{chat_id}")
        return _parse(raw)

    async def save(self, chat: Chat) -> None:
        pipe = self._redis.pipeline(transaction=False)
        pipe.set(f"{_CHAT}{chat.id}", json.dumps(chat.as_dict()), ex=CHAT_TTL_S)
        pipe.zadd(f"{_OWNER}{chat.owner}", {chat.id: chat.updated})
        # The refresh that keeps the index from outliving — or predeceasing —
        # what it points at. An index 30 days after the last activity is the
        # correct index: somebody with no activity for 30 days has no chats.
        pipe.expire(f"{_OWNER}{chat.owner}", CHAT_TTL_S)
        await pipe.execute()

    async def load_many(self, owner: str, limit: int) -> list[Chat]:
        index = f"{_OWNER}{owner}"
        ids = await self._redis.zrevrange(index, 0, limit - 1)
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
        # The second half of the skew fix: an id whose chat has expired is
        # dropped from the index now, so the list is not paying for it again.
        if missing:
            await self._redis.zrem(index, *missing)
        return chats

    async def delete(self, chat: Chat) -> None:
        pipe = self._redis.pipeline(transaction=False)
        pipe.delete(f"{_CHAT}{chat.id}")
        pipe.zrem(f"{_OWNER}{chat.owner}", chat.id)
        await pipe.execute()

    async def has(self, owner: str) -> bool:
        return bool(await self._redis.exists(f"{_OWNER}{owner}"))

    async def reassign(self, source: str, target: str) -> int:
        ids = await self._redis.zrange(f"{_OWNER}{source}", 0, -1)
        moved = 0
        for chat_id in ids:
            chat = _parse(await self._redis.get(f"{_CHAT}{chat_id}"))
            # An id with nothing behind it is an expired chat, which is exactly
            # what the source index is dropped for at the end.
            if chat is None:
                continue
            chat.owner = target
            await self.save(chat)
            moved += 1
        await self._redis.delete(f"{_OWNER}{source}")
        return moved

    async def close(self) -> None:
        await self._redis.aclose()


def _parse(raw: str | None) -> Chat | None:
    if not raw:
        return None
    try:
        return Chat.from_dict(json.loads(raw))
    except (ValueError, TypeError):
        return None


def backend_for(redis_url: str) -> Backend:
    """Redis when there is one, a dict when there is not.

    The same shape apps/api/src/cache/cache.service.ts uses, for the same
    reason: local development should not require a Redis, and the fallback
    being in-process is honest about what it is — one instance, gone on
    restart, which is precisely what production stopped being.
    """
    return RedisBackend(redis_url) if redis_url else MemoryBackend()
