from redis.asyncio import ConnectionPool, Redis

_LPDOWN = "agent:lpdown:"


class RedisStrategies:
    def __init__(self, pool: ConnectionPool) -> None:
        self._redis = Redis(connection_pool=pool)

    async def lpdown(self, portfolio: str) -> frozenset[str]:
        members = await self._redis.smembers(f"{_LPDOWN}{portfolio}")
        return frozenset(one.decode() if isinstance(one, bytes) else str(one) for one in members)

    async def adopt(self, portfolio: str, position: str) -> None:
        await self._redis.sadd(f"{_LPDOWN}{portfolio}", position)

    async def drop(self, portfolio: str, position: str) -> None:
        await self._redis.srem(f"{_LPDOWN}{portfolio}", position)
