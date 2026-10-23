import time

from redis.asyncio import Redis


class MemoryStore:
    """The store in this process: for tests and a local run without Redis."""

    def __init__(self) -> None:
        self._items: dict[str, tuple[str, float | None]] = {}

    async def get(self, key: str) -> str | None:
        item = self._items.get(key)
        if item is None:
            return None
        value, until = item
        if until is not None and until <= time.time():
            del self._items[key]
            return None
        return value

    async def put(self, key: str, value: str, ttl: int | None = None) -> None:
        self._items[key] = (value, time.time() + ttl if ttl else None)

    async def take(self, key: str) -> str | None:
        value = await self.get(key)
        self._items.pop(key, None)
        return value

    async def drop(self, key: str) -> None:
        self._items.pop(key, None)


class RedisStore:
    """OAuth state that has to outlive a deploy: registered clients and issued tokens."""

    PREFIX = "mcp:"

    def __init__(self, url: str) -> None:
        self._redis = Redis.from_url(url, decode_responses=True)

    async def get(self, key: str) -> str | None:
        return _text(await self._redis.get(self.PREFIX + key))

    async def put(self, key: str, value: str, ttl: int | None = None) -> None:
        await self._redis.set(self.PREFIX + key, value, ex=ttl)

    async def take(self, key: str) -> str | None:
        return _text(await self._redis.getdel(self.PREFIX + key))

    async def drop(self, key: str) -> None:
        await self._redis.delete(self.PREFIX + key)


Store = MemoryStore | RedisStore


def _text(value: str | bytes | None) -> str | None:
    return value.decode() if isinstance(value, bytes) else value
